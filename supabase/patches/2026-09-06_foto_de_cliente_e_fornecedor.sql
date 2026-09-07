-- Foto de perfil de cliente e fornecedor.
--
-- Os cards da lista de Cadastros caiam sempre no monograma (iniciais do nome),
-- e com trinta fornecedores isso e trinta caixas iguais: o olho nao acha
-- ninguem. A coluna guarda a foto do MESMO jeito que `products.image` — data
-- URL base64, nao caminho de bucket — porque este projeto nao usa Storage
-- (zero buckets, conferido em 2026-09-06) e a foto precisa vir junto com a
-- linha na mesma query que ja alimenta a tela.
--
-- O teto real e do lado do cliente: `comprimirImagemParaTeto` reduz a imagem
-- ate caber em ~60 KB antes de gravar. Sem isso, uma foto de celular viraria
-- ~5 MB de base64 numa lista que carrega inteira.

alter table public.clients   add column if not exists image text;
alter table public.suppliers add column if not exists image text;

comment on column public.clients.image   is 'Foto do cliente: data URL base64, teto ~60 KB (reduzida no navegador).';
comment on column public.suppliers.image is 'Logo/foto do fornecedor: data URL base64, teto ~60 KB (reduzida no navegador).';
