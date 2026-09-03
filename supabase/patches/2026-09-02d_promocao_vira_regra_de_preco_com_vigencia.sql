-- ============================================================
-- Patch: promocao_vira_regra_de_preco_com_vigencia
-- Data:  2026-09-02
-- ============================================================
-- Espelha a migracao 578 do LogMax. Os dois sistemas passam a ensinar o mesmo
-- modelo de preco, que e o do varejo:
--
--   o produto tem um PRECO BASE que fica intocado no cadastro;
--   a promocao e uma REGRA — produto, loja, periodo, preco;
--   o PDV RESOLVE o preco no momento da venda: existe regra valendo hoje?
--   entao e esse preco; senao, o preco base.
--
-- Ate aqui a liberacao dava UPDATE em `products.price` e o preco de tabela
-- virava uma copia dentro da promocao (`price_before`). Isso produzia tres
-- defeitos que pareciam separados e eram o mesmo:
--
--   - a varredura de reversao so existia porque houve sobrescrita. Num sistema
--     real nao se "reverte promocao": a regra deixa de valer e pronto;
--   - `start_date` no futuro nao era respeitado — aprovar e aplicar preco eram
--     o mesmo ato. Com vigencia, aprovar e autorizar e a data manda;
--   - duas ofertas no mesmo produto perdiam o preco de tabela original, porque
--     a segunda carimbava o promocional da primeira como "de".
--
-- Os tres morrem aqui, sem codigo proprio.
--
-- ─── Diferenca em relacao ao LogMax ─────────────────────────────────────────
-- La a troca teve de ser atomica com a trava de `criar_venda_pdv`, que confere
-- o preco enviado pelo caixa contra o cadastro e recusaria toda venda em
-- oferta. Aqui `finalize_sale_atomic` NAO confere preco nenhum: grava o que o
-- caixa mandar. Entao nada quebra — mas tambem nada protege.
--
-- Fica registrado: a trava de preco no servidor e a proxima peca de paridade.
-- Ela nao entra neste patch para nao estrear uma recusa nova de venda no mesmo
-- deploy que muda o modelo de preco.
--
-- `promocao_vigente_do_produto()` e o unico lugar que sabe o que e "oferta
-- valendo hoje". A view do PDV e `preco_efetivo()` derivam dela, em vez de
-- repetir o predicado e ve-lo divergir no proximo patch.
--
-- Oferta sem `end_date` nao existe aqui (a coluna e NOT NULL), mas o predicado
-- ja trata NULL como prazo indeterminado, igual ao LogMax.

-- ─── 1. Devolver o que ja foi sobrescrito ────────────────────
-- Com a regua antiga: so devolve se o preco vigente ainda for exatamente o
-- promocional. Remarcacao manual no meio do caminho vale.
UPDATE products p
   SET price = pr.price_before
  FROM promocoes pr
 WHERE pr.product_id = p.id
   AND pr.status = 'Aprovado'
   AND COALESCE(pr.price_before, 0) > 0
   AND p.price = pr.promo_price;

UPDATE promocoes
   SET status = 'Encerrado'
 WHERE status = 'Aprovado'
   AND end_date < hoje_operacao();

-- ─── 2. A regra, num lugar so ────────────────────────────────
CREATE OR REPLACE FUNCTION public.promocao_vigente_do_produto(
  p_product_id text,
  p_data date DEFAULT NULL
)
 RETURNS SETOF public.promocoes
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT m.*
    FROM public.promocoes m
    JOIN public.products pr ON pr.id = m.product_id
   WHERE m.product_id = p_product_id
     AND m.status = 'Aprovado'
     AND COALESCE(m.promo_price, 0) > 0
     -- Oferta que nao baixa o preco nao e oferta. Tambem impede regra velha de
     -- "subir" o preco se a tabela baixou depois.
     AND m.promo_price < pr.price
     AND COALESCE(p_data, hoje_operacao()) >= COALESCE(m.start_date, COALESCE(p_data, hoje_operacao()))
     AND COALESCE(p_data, hoje_operacao()) <= COALESCE(m.end_date,   COALESCE(p_data, hoje_operacao()))
   ORDER BY m.promo_price ASC, m.end_date ASC NULLS LAST, m.id
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.promocao_vigente_do_produto(text, date) IS
  'A oferta que vale para o produto na data (a mais barata, se houver mais de uma). Unico lugar que define vigencia — a view do PDV e preco_efetivo() derivam daqui.';

-- ─── 3. O preco que o caixa cobra ────────────────────────────
CREATE OR REPLACE FUNCTION public.preco_efetivo(p_product_id text, p_data date DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT promo_price FROM public.promocao_vigente_do_produto(p_product_id, p_data)),
    (SELECT price       FROM public.products WHERE id = p_product_id)
  );
$function$;

COMMENT ON FUNCTION public.preco_efetivo(text, date) IS
  'Preco de venda do produto na data: a oferta vigente, se houver; senao o preco de tabela.';

-- ─── 4. O que o PDV le ───────────────────────────────────────
-- `preco_de` agora sai de `products.price` VIVO, nao mais do snapshot
-- `price_before`: com o preco base intocado, o "de" e o preco de tabela de
-- verdade e nao uma copia que envelhece.
DROP VIEW IF EXISTS public.v_promocao_vigente;

CREATE VIEW public.v_promocao_vigente
WITH (security_invoker = false) AS
SELECT
  pr.id       AS product_id,
  m.pdv_mode,
  pr.price    AS preco_de,
  m.promo_price AS preco_por,
  m.start_date,
  m.end_date,
  m.description
FROM public.products pr
CROSS JOIN LATERAL public.promocao_vigente_do_produto(pr.id) m
WHERE COALESCE(public.pode_loja(m.pdv_mode), false);

COMMENT ON VIEW public.v_promocao_vigente IS
  'Ofertas valendo hoje, recortadas pela loja de quem consulta. Sem custo — e a fonte do de/por no PDV.';

-- ─── 5. Liberar deixa de mexer no cadastro ───────────────────
CREATE OR REPLACE FUNCTION public.aprovar_promocao(p_id text, p_observacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_promo   promocoes;
  v_nome    text;
  v_vigente boolean;
BEGIN
  IF meu_nivel() < 80 THEN
    RAISE EXCEPTION 'Liberar oferta e da gestao (CEO ou Admin Master) — o caixa nao aprova o proprio preco.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status = 'Pendente' THEN
    RAISE EXCEPTION 'Falta o parecer do Financeiro — a margem e conferida antes de a oferta ir ao caixa.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.status <> 'Em Analise' THEN
    RAISE EXCEPTION 'So oferta analisada pode ser liberada (esta esta %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.end_date < hoje_operacao() THEN
    RAISE EXCEPTION 'O periodo desta promocao terminou em %.', to_char(v_promo.end_date, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();

  UPDATE promocoes
     SET status = 'Aprovado',
         decided_by_name = COALESCE(v_nome, 'Gestao'),
         decided_at = NOW(),
         observacao = COALESCE(p_observacao, observacao)
   WHERE id = p_id;

  -- NAO se mexe mais em `products.price`. A liberacao autoriza a regra; quem
  -- decide se ela vale hoje e o calendario.
  SELECT EXISTS (SELECT 1 FROM public.promocao_vigente_do_produto(v_promo.product_id))
    INTO v_vigente;

  RETURN jsonb_build_object(
    'id', p_id,
    'status', 'Aprovado',
    'preco', v_promo.promo_price,
    'vigente_hoje', COALESCE(v_vigente, false),
    'start_date', v_promo.start_date
  );
END;
$function$;

-- ─── 6. A varredura perde a razao de existir ─────────────────
-- Nao ha preco para devolver. Mantida como faxina do calendario — e,
-- principalmente, PARA de escrever em `products`: ela casava
-- `price = promo_price`, e um produto cujo preco de tabela por acaso
-- coincidisse com o de uma oferta velha teria o preco trocado por um
-- `price_before` de meses atras.
CREATE OR REPLACE FUNCTION public.reverter_promocoes_expiradas()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_qtd integer := 0;
BEGIN
  WITH encerradas AS (
    UPDATE promocoes SET status = 'Encerrado'
     WHERE status = 'Aprovado' AND end_date < hoje_operacao()
    RETURNING 1
  )
  SELECT count(*) INTO v_qtd FROM encerradas;
  RETURN v_qtd;
END;
$function$;

COMMENT ON FUNCTION public.reverter_promocoes_expiradas() IS
  'Nao devolve preco nenhum — o preco base nunca e sobrescrito. So encerra a oferta cujo periodo passou.';

REVOKE ALL ON FUNCTION public.promocao_vigente_do_produto(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preco_efetivo(text, date)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocao_vigente_do_produto(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preco_efetivo(text, date)               TO authenticated;

REVOKE ALL ON public.v_promocao_vigente FROM PUBLIC, anon;
GRANT SELECT ON public.v_promocao_vigente TO authenticated;

NOTIFY pgrst, 'reload schema';
