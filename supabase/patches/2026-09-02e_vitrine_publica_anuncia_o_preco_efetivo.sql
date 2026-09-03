-- ============================================================
-- Patch: vitrine_publica_anuncia_o_preco_efetivo
-- Data:  2026-09-02
-- ============================================================
-- Continuacao de 2026-09-02d.
--
-- A vitrine da tela de entrada le `products.price`. Antes isso era o preco
-- cobrado, porque a liberacao da promocao sobrescrevia o cadastro. Agora
-- `price` e o preco de TABELA, e a regra de preco mora na promocao — entao a
-- vitrine estaria mostrando o preco cheio de um item em oferta, na primeira
-- tela que o cliente ve.
--
-- `preco_efetivo()` resolve. E SECURITY DEFINER e nao pergunta quem esta
-- olhando: so devolve numero, sem custo e sem quem propos — o que e exatamente
-- o que uma vitrine publica pode mostrar.

CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
 RETURNS TABLE(id text, name text, image text, price numeric, marca text, category text, pdv_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.name, p.image, public.preco_efetivo(p.id), p.marca, p.category, p.pdv_mode
  from public.products p
  where p.vitrine = true
    and p.image is not null
    and p.image <> ''
  order by p.name
  -- Teto de 12: `image` e base64 de ate 120 KB, e isto trafega ANTES do
  -- login. Sem limite, marcar a vitrine inteira faria a tela de entrada
  -- baixar megabytes.
  limit 12;
$function$;

NOTIFY pgrst, 'reload schema';
