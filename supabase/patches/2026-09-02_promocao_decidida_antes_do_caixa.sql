-- ============================================================
-- Patch: promocao_decidida_antes_do_caixa
-- Data:  2026-09-02
-- ============================================================
-- O MaxPOS e onde a turma TREINA para operar o LogMax, e ate aqui os dois
-- ensinavam coisas opostas sobre preco:
--
--   - no MaxPOS o operador dava desconto por item no proprio caixa;
--   - no LogMax (e no supermercado de verdade) o preco chega pronto: promocao
--     e decidida antes, entra no cadastro, e o caixa so bipa.
--
-- Este patch traz o modelo de promocao do LogMax para ca. Ele e simples de
-- proposito e imita o que a rede faz:
--
--   1. alguem PROPOE a oferta (produto, preco promocional, periodo);
--   2. a gestao (CEO ou Admin Master) APROVA;
--   3. a aprovacao TROCA o preco do produto — a partir dai o PDV vende pelo
--      preco novo sem saber que houve promocao;
--   4. no fim do periodo o preco VOLTA sozinho.
--
-- O "de" (preco antes da oferta) fica guardado em `price_before`. Sem ele nao
-- da para mostrar "de/por" no caixa nem calcular o "voce economizou" do cupom,
-- que e o que o cliente procura.
--
-- Por que a reversao nao e cron: o MaxPOS nao tem backend proprio (e um SPA
-- Vite, sem funcoes serverless). Entao `reverter_promocoes_expiradas()` e
-- idempotente e roda quando o app abre. Se ninguem abrir o sistema, nao ha
-- caixa vendendo — o preco so precisa estar certo quando alguem opera.
--
-- Fuso: America/Rio_Branco, o mesmo do LogMax. Vigencia conferida no banco e
-- nao no navegador: maquina de aluno com a data errada nao pode ressuscitar
-- oferta vencida.

-- ─── Tabela ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promocoes (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name  TEXT NOT NULL DEFAULT '',
  price_before  NUMERIC(12,2) NOT NULL,
  promo_price   NUMERIC(12,2) NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'Pendente',
  pdv_mode      TEXT NOT NULL DEFAULT 'supermax',
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  decided_by_name TEXT,
  decided_at      TIMESTAMPTZ,
  observacao    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promocoes_status_valido CHECK (status IN ('Pendente','Aprovado','Reprovado','Encerrado')),
  CONSTRAINT promocoes_preco_desce   CHECK (promo_price > 0 AND promo_price < price_before),
  CONSTRAINT promocoes_periodo       CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS promocoes_produto_idx ON promocoes (product_id);
CREATE INDEX IF NOT EXISTS promocoes_vigencia_idx ON promocoes (status, end_date);

ALTER TABLE promocoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promocoes_por_loja ON promocoes;
CREATE POLICY promocoes_por_loja ON promocoes
  FOR ALL TO authenticated
  USING      (pode_loja(pdv_mode))
  WITH CHECK (pode_loja(pdv_mode));

-- Apagar oferta e da gestao: promocao aprovada mexeu no preco, e a linha e o
-- unico registro de qual era o preco antes.
DROP POLICY IF EXISTS promocoes_delete_gestao ON promocoes;
CREATE POLICY promocoes_delete_gestao ON promocoes
  FOR DELETE TO authenticated
  USING (meu_nivel() >= 80);

-- ─── Hoje, no fuso da operacao ───────────────────────────────
CREATE OR REPLACE FUNCTION public.hoje_operacao()
 RETURNS date LANGUAGE sql STABLE
AS $function$
  SELECT (NOW() AT TIME ZONE 'America/Rio_Branco')::date;
$function$;

-- ─── Aprovar: e aqui que o preco muda ────────────────────────
CREATE OR REPLACE FUNCTION public.aprovar_promocao(p_id text, p_observacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_promo promocoes;
  v_nome  text;
BEGIN
  IF meu_nivel() < 80 THEN
    RAISE EXCEPTION 'Promocao e decisao da gestao (CEO ou Admin Master) — o caixa nao aprova o proprio preco.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta promocao ja foi %.', lower(v_promo.status) USING ERRCODE = 'P0001';
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

  -- O preco e a razao de existir da aprovacao. Se ele nao mudar, a aprovacao
  -- nao pode ficar de pe.
  UPDATE products SET price = v_promo.promo_price WHERE id = v_promo.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto da promocao nao encontrado — a aprovacao nao chegaria ao PDV.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', 'Aprovado', 'preco', v_promo.promo_price);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reprovar_promocao(p_id text, p_motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_nome text;
BEGIN
  IF meu_nivel() < 80 THEN
    RAISE EXCEPTION 'Promocao e decisao da gestao (CEO ou Admin Master).' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(length(trim(p_motivo)), 0) < 5 THEN
    RAISE EXCEPTION 'Diga por que a oferta foi recusada — quem propos precisa saber o que corrigir.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();
  UPDATE promocoes
     SET status = 'Reprovado', observacao = p_motivo,
         decided_by_name = COALESCE(v_nome, 'Gestao'), decided_at = NOW()
   WHERE id = p_id AND status = 'Pendente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada ou ja decidida.' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- ─── Fim do periodo: o preco volta ───────────────────────────
-- Idempotente e sem privilegio: qualquer sessao pode chamar quando o app abre.
-- So devolve o preco de quem esta 'Aprovado' e ja venceu, e so se o preco
-- vigente ainda for o promocional (se alguem remarcou a mao no meio do
-- caminho, a remarcacao vale — nao vamos desfazer decisao de quem estava la).
CREATE OR REPLACE FUNCTION public.reverter_promocoes_expiradas()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_promo promocoes;
  v_qtd integer := 0;
BEGIN
  FOR v_promo IN
    SELECT * FROM promocoes
     WHERE status = 'Aprovado' AND end_date < hoje_operacao()
     ORDER BY id
     FOR UPDATE
  LOOP
    UPDATE products
       SET price = v_promo.price_before
     WHERE id = v_promo.product_id
       AND price = v_promo.promo_price;

    UPDATE promocoes SET status = 'Encerrado' WHERE id = v_promo.id;
    v_qtd := v_qtd + 1;
  END LOOP;
  RETURN v_qtd;
END;
$function$;

-- ─── O que o PDV le ──────────────────────────────────────────
-- View estreita: produto, de, por, vigencia. Sem custo, sem quem propos.
DROP VIEW IF EXISTS public.v_promocao_vigente;
CREATE VIEW public.v_promocao_vigente
WITH (security_invoker = false) AS
SELECT
  p.product_id,
  p.pdv_mode,
  p.price_before AS preco_de,
  p.promo_price  AS preco_por,
  p.start_date,
  p.end_date,
  p.description
FROM public.promocoes p
WHERE p.status = 'Aprovado'
  AND hoje_operacao() BETWEEN p.start_date AND p.end_date
  AND COALESCE(public.pode_loja(p.pdv_mode), false);

COMMENT ON VIEW public.v_promocao_vigente IS
  'Ofertas aprovadas e vigentes hoje, recortadas pela loja de quem consulta. Fonte do "de/por" no PDV.';

REVOKE ALL ON FUNCTION public.aprovar_promocao(text, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reprovar_promocao(text, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverter_promocoes_expiradas()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hoje_operacao()                   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_promocao(text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.reprovar_promocao(text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_promocoes_expiradas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hoje_operacao()                TO authenticated;

REVOKE ALL ON public.v_promocao_vigente FROM PUBLIC, anon;
GRANT SELECT ON public.v_promocao_vigente TO authenticated;

NOTIFY pgrst, 'reload schema';
