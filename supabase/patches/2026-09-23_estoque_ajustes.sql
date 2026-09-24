-- ============================================================
-- Patch: estoque_ajustes
-- Data:  2026-09-23
-- ============================================================
-- O "Editar estoque" (somar / subtrair / corrigir) so sobrescrevia
-- `products.stock`. Nao ficava registro nenhum: o card "Movimentacoes" do
-- Estoque contava apenas as saidas por venda, e uma entrada de mercadoria
-- sumia sem rastro — o saldo mudava e ninguem sabia quando nem quanto.
--
-- Esta tabela e o historico desses ajustes. Uma linha por ajuste, gravada
-- pelo cliente logo depois que o saldo novo foi aceito pelo banco.
--
-- `quantidade` e o DELTA com sinal (saldo_novo - saldo_anterior): +10 numa
-- entrada, -3 numa baixa. Na correcao pode ser qualquer um dos dois — o que
-- importa e o quanto o saldo andou, e os dois saldos ficam guardados.
--
-- `product_name` e copiado na hora: o historico continua legivel mesmo que o
-- produto seja renomeado ou excluido depois. Por isso `product_id` nao tem FK.
--
-- Historico nao se edita: so ha policy de SELECT e INSERT. Nem o
-- `factory_reset` apaga esta tabela — ele preserva cadastros e saldo, e estes
-- ajustes sao justamente o que explica o saldo que ficou.
--
-- Isolamento por empresa: a mesma policy RESTRICTIVE de `products`.

CREATE TABLE IF NOT EXISTS public.estoque_ajustes (
  id             uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id     text NOT NULL,
  product_name   text NOT NULL,
  pdv_mode       text NOT NULL,
  tipo           text NOT NULL,
  quantidade     numeric(12,3) NOT NULL,
  saldo_anterior numeric(12,3) NOT NULL,
  saldo_novo     numeric(12,3) NOT NULL,
  user_id        uuid DEFAULT auth.uid(),
  created_at     timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT estoque_ajustes_pkey PRIMARY KEY (id),
  CONSTRAINT estoque_ajustes_pdv_mode_check CHECK (pdv_mode IN ('supermax', 'maxlook', 'techmax')),
  CONSTRAINT estoque_ajustes_tipo_check CHECK (tipo IN ('entrada', 'saida', 'correcao'))
);

CREATE INDEX IF NOT EXISTS estoque_ajustes_loja_data_idx
  ON public.estoque_ajustes (pdv_mode, created_at DESC);

ALTER TABLE public.estoque_ajustes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_ajustes_select ON public.estoque_ajustes;
CREATE POLICY estoque_ajustes_select ON public.estoque_ajustes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS estoque_ajustes_insert ON public.estoque_ajustes;
CREATE POLICY estoque_ajustes_insert ON public.estoque_ajustes FOR INSERT TO authenticated
  WITH CHECK ((SELECT tenho_perfil() AS tenho_perfil));

DROP POLICY IF EXISTS estoque_ajustes_isolada_por_loja ON public.estoque_ajustes;
CREATE POLICY estoque_ajustes_isolada_por_loja ON public.estoque_ajustes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode])))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode])));

GRANT SELECT, INSERT ON public.estoque_ajustes TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='estoque_ajustes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.estoque_ajustes;
  END IF;
END $$;
