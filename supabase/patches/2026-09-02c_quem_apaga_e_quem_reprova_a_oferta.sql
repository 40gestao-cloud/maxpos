-- ============================================================
-- Patch: quem_apaga_e_quem_reprova_a_oferta
-- Data:  2026-09-02
-- ============================================================
-- Dois guards da cadeia de promocao (patches 2026-09-02 e 2026-09-02b) nao
-- estavam de pe. Nenhum dos dois aparece na tela — os dois se atravessa
-- chamando o PostgREST direto —, e os dois abrem no minuto em que o
-- provisionar-operadores.mjs criar o primeiro Operador de Caixa.
--
-- 1) APAGAR OFERTA nao era da gestao.
--
--    A `promocoes_delete_gestao` nasceu PERMISSIVE ao lado da
--    `promocoes_por_loja`, que e FOR ALL e tambem PERMISSIVE. Policies
--    permissivas se SOMAM: para DELETE o banco avaliava
--
--        pode_loja(pdv_mode)  OR  meu_nivel() >= 80
--
--    e o operador passava pela primeira. A regra virava enfeite.
--
--    Isso importa porque apagar oferta APROVADA apaga o `price_before`, que e
--    o unico registro do preco de tabela. Sem ele
--    `reverter_promocoes_expiradas` nao tem para onde voltar e o produto fica
--    preso no preco promocional para sempre.
--
--    A correcao e a mesma que o patch 2026-09-01b ja tinha usado em products,
--    clients e sales: RESTRICTIVE, que entra como AND. Depois deste patch o
--    DELETE exige `pode_loja(pdv_mode) AND meu_nivel() >= 80`.
--
-- 2) REPROVAR nao conferia a empresa.
--
--    O patch 'b' tirou o `meu_nivel() >= 80` de `reprovar_promocao` de
--    proposito — recusar cabe nos dois passos da cadeia, e no MaxPOS o passo do
--    Financeiro e livre. Mas nao pos no lugar o `pode_loja()` que a irma
--    `analisar_promocao` tem. Como a funcao e SECURITY DEFINER, a RLS da tabela
--    nao a alcanca: o operador da MaxLook reprovava oferta da SuperMax.
--
--    Aqui ela ganha a mesma conferencia de empresa da `analisar_promocao`, e a
--    mensagem de status passa a dizer em que pe a oferta esta em vez de um
--    'nao encontrada ou ja decidida' que servia para tudo.

-- ─── 1. Apagar oferta e da gestao (agora de verdade) ─────────
DROP POLICY IF EXISTS promocoes_delete_gestao ON public.promocoes;
CREATE POLICY promocoes_delete_gestao ON public.promocoes
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.meu_nivel() >= 80);

-- ─── 2. Reprovar confere a empresa ───────────────────────────
CREATE OR REPLACE FUNCTION public.reprovar_promocao(p_id text, p_motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_promo promocoes;
  v_nome  text;
BEGIN
  IF COALESCE(length(trim(p_motivo)), 0) < 5 THEN
    RAISE EXCEPTION 'Diga por que a oferta foi recusada — quem propos precisa saber o que corrigir.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(pode_loja(v_promo.pdv_mode), false) THEN
    RAISE EXCEPTION 'Oferta de outra empresa.' USING ERRCODE = '42501';
  END IF;
  IF v_promo.status NOT IN ('Pendente', 'Em Analise') THEN
    RAISE EXCEPTION 'So oferta em curso pode ser reprovada (esta esta %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();

  -- 'Decisao' e nao 'Gestao': depois do patch 'b' quem recusa tambem pode ser
  -- o passo do Financeiro, que no MaxPOS nao exige nivel.
  UPDATE promocoes
     SET status = 'Reprovado',
         observacao = p_motivo,
         decided_by_name = COALESCE(v_nome, 'Decisao'),
         decided_at = NOW()
   WHERE id = p_id;
END;
$function$;

REVOKE ALL  ON FUNCTION public.reprovar_promocao(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprovar_promocao(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
