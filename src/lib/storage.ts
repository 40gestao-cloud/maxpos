import { supabase } from './supabase';
import { exigirSenhaSegura } from './senhaSegura';
import { Product, Client, Service, Category, VitrineItem, Sale, Account, Appointment, User, CreditInstallment, CashSession, CashMovement, AuditLogEntry, FolhaPagamento, MaxbankConta, MaxbankTransacao, Promocao, OfertaVigente, AjusteEstoque } from '../types';

/**
 * Restringe uma query à empresa informada. Sem `pdvMode` a query passa
 * intacta (leituras que realmente valem para as três).
 *
 * Igualdade simples, sem tratar `pdv_mode IS NULL`. Isso ERA necessário — a
 * coluna nasceu depois das linhas, e a régua "linha sem empresa é do
 * supermercado" mantinha o legado visível. Hoje não é mais: `products`,
 * `clients`, `sales`, `accounts`, `services`, `suppliers` e `promocoes` são
 * todas `NOT NULL DEFAULT 'supermax'`, então o banco já não deixa a linha órfã
 * existir, e a migração de dados terminou (zero linhas nulas nas sete).
 *
 * Tirar o `OR` rende duas coisas. A primeira é o plano: com ele o Postgres
 * monta um BitmapOr de dois índices em vez de um index scan direto. A segunda
 * importa mais — o filtro do Realtime é `pdv_mode=eq.<empresa>`, que por
 * construção NUNCA casa com NULL. Enquanto a consulta e a assinatura
 * discordassem, elas só concordavam por não existir linha nula; a primeira que
 * aparecesse ficaria visível na tela e invisível para o tempo real, que é a
 * classe de bug mais difícil de enxergar que existe.
 */
const escopoFilial = <T>(q: T, pdvMode?: string | null): T => {
  if (!pdvMode) return q;
  return (q as any).eq('pdv_mode', pdvMode) as T;
};

// `escopoFilialComSemEmpresa` existiu aqui até 2026-09-19e. Era só para
// `categories`, a única tabela do escopo cuja `pdv_mode` ainda aceitava NULL —
// e NULL significava "categoria das três empresas". Isso caiu junto com o
// seletor de empresa do formulário: a categoria pertence à empresa em que foi
// criada, e a coluna virou NOT NULL DEFAULT 'supermax'. Sem a exceção, a
// consulta volta a concordar exatamente com o filtro do Realtime.

// Uma linha de `sales` (com sale_items/sale_payments embutidos) virando Sale.
// Três leituras diferentes montavam este objeto na mão e já divergiam entre si
// — a de reimpressão trazia discount/cpfCnpjNota, getSales não. Com os campos
// de nicho entrando, centralizar evita a próxima divergência.
function mapSaleRow(row: any): Sale {
  return {
    id: row.id,
    date: row.date,
    total: Number(row.total),
    clientId: row.clientId ?? undefined,
    vendedorId: row.vendedorId ?? undefined,
    status: row.status,
    discount: Number(row.discount ?? 0),
    cpfCnpjNota: row.cpfCnpjNota ?? undefined,
    // Origem da venda + campos que só MaxLook/TechMax preenchem. Venda
    // anterior ao patch 2026-08-17 cai em 'supermax', que era o único PDV
    // que gravava.
    pdvMode: row.pdv_mode ?? 'supermax',
    vendedorNome: row.vendedor_nome ?? undefined,
    imeiSerial: row.imei_serial ?? undefined,
    tipoAtendimento: row.tipo_atendimento ?? undefined,
    defeitoRelatado: row.defeito_relatado ?? undefined,
    items: (row.sale_items ?? []).map((item: any) => ({
      id: item.productId ?? item.id,
      name: item.name,
      price: Number(item.price),
      quantity: Number(item.quantity),
      costPrice: Number(item.costPrice ?? 0),
      category: item.category ?? '',
      ref: item.ref ?? '',
      unit: item.unit ?? 'UN',
      ean13: item.ean13,
      controlStock: item.controlStock ?? true,
      stock: Number(item.stock ?? 0),
      minStock: item.minStock ?? 0,
      discount: Number(item.discount ?? 0),
    })),
    payments: (row.sale_payments ?? []).map((p: any) => ({
      method: p.method,
      amount: Number(p.amount),
      installments: p.installments ?? undefined,
      clientId: p.clientId ?? undefined,
    })),
  } as Sale;
}

// ─── Foto de produto no Supabase Storage ─────────────────────
// A coluna `products.image` guarda a URL pública do arquivo, não mais o
// base64 (patch 2026-09-18b). O caminho é `<empresa>/<id do produto>`, sem
// extensão: trocar a foto sobrescreve o mesmo arquivo, e o `?v=` na URL fura
// o cache do navegador/CDN — por isso o cache pode ser longo.
const BUCKET_FOTOS_PRODUTO = 'produtos';
const PREFIXO_URL_FOTO = `/storage/v1/object/public/${BUCKET_FOTOS_PRODUTO}/`;

const caminhoFotoProduto = (pdvMode: string, productId: string) => `${pdvMode}/${productId}`;

// Tudo de produto MENOS `image`. Numa constante porque duas leituras usam a
// mesma lista (a tela toda e o recorte por ids do Realtime), e uma coluna que
// entrasse só numa delas faria o produto mudar de forma ao ser atualizado.
const COLUNAS_PRODUTO_LITE =
  'id, name, price, costPrice, category, ref, stock, minStock, unit, ean13, controlStock, marca, pdv_mode, vitrine';

/** Caminho no bucket a partir da URL gravada; null se não for foto do Storage. */
const caminhoDaUrlFoto = (url?: string | null): string | null => {
  if (!url) return null;
  const i = url.indexOf(PREFIXO_URL_FOTO);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + PREFIXO_URL_FOTO.length).split('?')[0]);
};

async function enviarFotoProduto(dataUrl: string, pdvMode: string, productId: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const caminho = caminhoFotoProduto(pdvMode, productId);
  const { error } = await supabase.storage
    .from(BUCKET_FOTOS_PRODUTO)
    .upload(caminho, blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET_FOTOS_PRODUTO).getPublicUrl(caminho);
  return `${data.publicUrl}?v=${Date.now()}`;
}

// ─── Foto de cliente e de fornecedor no Storage ──────────────
// Bucket PRIVADO e restrito por empresa — na leitura também, ao contrário do
// de produto. Produto é catálogo e a vitrine é pública; isto é dado de pessoa,
// e quem opera a MaxLook não tem o que fazer com a foto de um cliente do
// SuperMax.
//
// A coluna `image` guarda o CAMINHO (`<empresa>/<tipo>/<id>`). Como a lista de
// clientes é carregada na abertura de TODO PDV, as URLs são assinadas em LOTE:
// uma ida ao servidor para a lista inteira, não uma por pessoa.
const BUCKET_CADASTROS = 'cadastros';
type TipoCadastro = 'clientes' | 'fornecedores';

type TipoCadastroFoto = TipoCadastro | 'categorias';

const caminhoFotoCadastro = (pdvMode: string, tipo: TipoCadastroFoto, id: string) =>
  `${pdvMode}/${tipo}/${id}`;

async function enviarFotoCadastro(
  dataUrl: string, pdvMode: string, tipo: TipoCadastroFoto, id: string,
): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const caminho = caminhoFotoCadastro(pdvMode, tipo, id);
  const { error } = await supabase.storage
    .from(BUCKET_CADASTROS)
    .upload(caminho, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' });
  if (error) throw error;
  return caminho;
}

/**
 * Troca os caminhos por URLs assinadas, numa consulta só para a lista inteira.
 *
 * Valor legado (base64 `data:` ou URL `http`) passa direto — foi assim que as
 * três fotos de fornecedor que existiam continuaram aparecendo enquanto a
 * migração não rodava, e é o que salva quem importar um dump antigo.
 */
async function resolverFotosCadastro<T extends { image?: string }>(linhas: T[]): Promise<T[]> {
  const caminhos = [...new Set(
    linhas
      .map(l => l.image)
      .filter((v): v is string => !!v && !v.startsWith('data:') && !v.startsWith('http')),
  )];
  if (caminhos.length === 0) return linhas;

  const { data, error } = await supabase.storage
    .from(BUCKET_CADASTROS)
    .createSignedUrls(caminhos, 3600);
  if (error) {
    // Degrade certo: a lista aparece sem foto em vez de não aparecer.
    console.warn('[resolverFotosCadastro] não foi possível assinar as URLs', error);
    return linhas.map(l => (l.image && !l.image.startsWith('data:') && !l.image.startsWith('http'))
      ? { ...l, image: undefined } : l);
  }
  const mapa = new Map((data ?? []).map((d: any) => [d.path, d.signedUrl]));
  return linhas.map(l => (l.image && mapa.has(l.image))
    ? { ...l, image: mapa.get(l.image) as string } : l);
}

/** Caminho no bucket a partir do que está gravado; null se não for do Storage. */
const caminhoDaFotoCadastro = (valor?: string | null): string | null =>
  (valor && !valor.startsWith('data:') && !valor.startsWith('http')) ? valor : null;

// ─── Foto de perfil no Supabase Storage ──────────────────────
// Mesma ideia da foto de produto, com UMA diferença que muda tudo: o bucket é
// PRIVADO. `produtos` é público porque a vitrine da tela de login mostra
// mercadoria sem sessão; rosto de pessoa não tem esse requisito, e o projeto já
// tinha tomado essa posição — foto de cliente e fornecedor ficou em base64
// justamente por o bucket existente ser público.
//
// Consequência prática: não existe URL fixa. A coluna `user_profiles.avatar`
// guarda o CAMINHO (que é o próprio id do dono), e quem vai exibir pede uma URL
// assinada, que expira. Por isso as leituras de perfil passam por
// `urlDoAvatar` antes de devolver o usuário.
const BUCKET_AVATARES = 'avatares';
/** Uma hora: o mesmo passo do refresh de token, então a URL não morre em uso. */
const VALIDADE_URL_AVATAR = 3600;

async function enviarAvatar(dataUrl: string, userId: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const { error } = await supabase.storage
    .from(BUCKET_AVATARES)
    .upload(userId, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' });
  if (error) throw error;
  return userId;
}

/**
 * Caminho gravado → URL que o `<img>` consegue abrir.
 *
 * Aceita valor legado sem reclamar: base64 (`data:`) e URL pública (`http`)
 * voltam como estão. Hoje não há nenhum no banco — a coluna estava zerada
 * quando isto entrou —, mas quem importar um dump antigo não fica com a tela
 * quebrada, e o custo de tolerar é uma linha.
 */
async function urlDoAvatar(valor?: string | null): Promise<string | undefined> {
  if (!valor) return undefined;
  if (valor.startsWith('data:') || valor.startsWith('http')) return valor;
  const { data, error } = await supabase.storage
    .from(BUCKET_AVATARES)
    .createSignedUrl(valor, VALIDADE_URL_AVATAR);
  // Falhar aqui mostra a inicial do nome no lugar da foto. É o degrade certo:
  // ninguém fica sem entrar no sistema porque a foto não carregou.
  if (error) {
    console.warn('[urlDoAvatar] não foi possível assinar a URL da foto', error);
    return undefined;
  }
  return data?.signedUrl;
}

export const Storage = {
  // ─── Produtos ────────────────────────────────────────────
  // pdv_mode (SQL snake_case) <-> pdvMode (JS camelCase) mapeado nas
  // leituras/escritas. Legado sem coluna cai em 'supermax' (default).
  // `pdvMode` filtra NO SERVIDOR. Sem ele, abrir o PDV SuperMax baixava os
  // 105 produtos das três lojas — inclusive ~1,5 MB de `image` em base64 que
  // pertencem a MaxLook/TechMax e que o SuperMax nem renderiza (a tela dele é
  // uma tabela de texto). O filtro por pdv_mode era feito depois, no cliente,
  // então o tráfego acontecia inteiro antes de ser descartado.
  // Sem argumento, continua trazendo tudo — é o que Cadastros e Estoque querem.
  getProducts: async (pdvMode?: Product['pdvMode']): Promise<Product[]> => {
    const q = escopoFilial(supabase.from('products').select('*'), pdvMode);
    const { data, error } = await q.order('name');
    if (error) throw error;
    // `pdv_mode` sai da linha crua: quem edita um produto joga essa linha
    // direto no formData, e upsertProduct manda de volta pro banco. Deixar as
    // duas chaves (pdv_mode E pdvMode) na mesma linha é só uma coluna a mais
    // que um dia vaza pro upsert e quebra com "column does not exist".
    return (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    })) as Product[];
  },

  // Só as linhas indicadas, com o mesmo escopo de empresa de getProducts.
  // Existe para o Realtime do Cadastros: uma venda baixa o estoque de 2-3
  // produtos, e recarregar o catálogo inteiro (com as fotos) para refletir
  // isso custava ~1,5 MB por venda. Id que não volta saiu da empresa ou foi
  // excluído — quem chama trata a ausência como remoção.
  getProductsByIds: async (ids: string[], pdvMode?: Product['pdvMode']): Promise<Product[]> => {
    if (ids.length === 0) return [];
    const q = escopoFilial(supabase.from('products').select('*').in('id', ids), pdvMode);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    })) as Product[];
  },

  // Mesma lista, SEM a coluna `image`. Existe para as telas que só precisam de
  // número — Estoque (alertas de reposição, movimentação, valor parado) não
  // desenha foto nenhuma, mas o `select('*')` fazia ela esperar ~1,5 MB de
  // base64 antes de mostrar o primeiro card.
  getProductsLite: async (pdvMode?: Product['pdvMode']): Promise<Product[]> => {
    // Escopo no SERVIDOR, como em getProducts. Sem ele o Estoque baixava as
    // tres empresas e descartava duas no cliente — trafego a toa e, pior, um
    // filtro que so existe na tela: some o `.filter` e a loja errada aparece.
    const q = escopoFilial(supabase
      .from('products')
      .select(COLUNAS_PRODUTO_LITE), pdvMode);
    const { data, error } = await q.order('name');
    if (error) throw error;
    return (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    })) as Product[];
  },

  // getProductsLite restrito a alguns ids — o que getProductsByIds é para
  // getProducts. Existe pelo mesmo motivo, agora no Estoque: uma venda mexe em
  // 2-3 produtos, e a tela recarregava o catálogo inteiro para refletir isso.
  // Numa turma isso é caro duas vezes: é o catálogo inteiro POR terminal, e
  // todos os terminais recebem o mesmo evento no mesmo instante.
  getProductsLiteByIds: async (ids: string[], pdvMode?: Product['pdvMode']): Promise<Product[]> => {
    if (ids.length === 0) return [];
    const q = escopoFilial(supabase
      .from('products')
      .select(COLUNAS_PRODUTO_LITE)
      .in('id', ids), pdvMode);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    })) as Product[];
  },

  // ─── Vitrine (carrossel da tela de login) ────────────────
  // Leitura PUBLICA via RPC: a tela de login roda sem sessao, e a policy de
  // `products` e só para authenticated. A RPC e SECURITY DEFINER com lista
  // explicita de colunas — custo e estoque nunca saem.
  getVitrinePublica: async (): Promise<VitrineItem[]> => {
    const { data, error } = await supabase.rpc('get_vitrine_publica');
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      image: r.image,
      price: Number(r.price ?? 0),
      marca: r.marca ?? undefined,
      category: r.category ?? undefined,
      pdvMode: r.pdv_mode ?? 'supermax',
    })) as VitrineItem[];
  },

  setVitrine: async (productId: string, naVitrine: boolean): Promise<void> => {
    const { error } = await supabase
      .from('products')
      .update({ vitrine: naVitrine })
      .eq('id', productId);
    if (error) throw error;
  },

  // ─── Categorias ──────────────────────────────────────────
  getCategories: async (pdvMode?: string | null): Promise<Category[]> => {
    const q = escopoFilial(supabase
      .from('categories')
      .select('id, name, color, pdv_mode, active, image, markup_alvo'), pdvMode);
    const { data, error } = await q.order('name');
    if (error) throw error;
    const linhas = (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      color: r.color ?? undefined,
      pdvMode: r.pdv_mode ?? undefined,
      active: r.active !== false,
      image: r.image ?? undefined,
      markupAlvo: r.markup_alvo != null ? Number(r.markup_alvo) : undefined,
    })) as Category[];
    return resolverFotosCadastro(linhas);
  },

  /**
   * `pdvMode` é obrigatório desde 2026-09-19e — e é a empresa da SESSÃO, não
   * uma escolha do formulário. O formulário tinha um seletor de empresa, o que
   * permitia criar categoria da MaxLook estando dentro da SuperMax; a empresa é
   * o contexto da sessão em todo o resto do sistema, e aqui não podia ser
   * diferente.
   */
  upsertCategory: async (c: Category): Promise<void> => {
    const pdvMode = c.pdvMode ?? 'supermax';
    let image = c.image ?? null;
    // Mesmo tratamento de cliente e fornecedor: data URL vira arquivo no
    // salvar; ausência apaga o arquivo; URL assinada volta a ser o caminho,
    // senão a coluna passaria a guardar uma URL que expira em uma hora.
    if (typeof image === 'string' && image.startsWith('data:')) {
      image = await enviarFotoCadastro(image, pdvMode, 'categorias', c.id);
    } else if (!image) {
      supabase.storage.from(BUCKET_CADASTROS)
        .remove([caminhoFotoCadastro(pdvMode, 'categorias', c.id)])
        .catch(() => {});
      image = null;
    } else if (image.startsWith('http')) {
      image = caminhoFotoCadastro(pdvMode, 'categorias', c.id);
    }

    const { error } = await supabase.from('categories').upsert({
      id: c.id,
      name: c.name.trim(),
      color: c.color ?? null,
      pdv_mode: pdvMode,
      active: c.active,
      image,
      markup_alvo: c.markupAlvo ?? null,
    });
    if (error) throw error;
  },

  deleteCategory: async (id: string): Promise<void> => {
    const { data: antes } = await supabase.from('categories')
      .select('image').eq('id', id).maybeSingle();
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    const caminho = caminhoDaFotoCadastro((antes as any)?.image);
    if (caminho) {
      supabase.storage.from(BUCKET_CADASTROS).remove([caminho]).catch(() => {});
    }
  },

  /**
   * Renomeia a categoria E arrasta os produtos/serviços que apontavam pro
   * nome antigo. Sem isso o cadastro passaria a dizer "Mercearia" enquanto
   * os produtos continuariam com "Comidas" — a tela e o dado divergindo.
   *
   * `pdvMode` NÃO é opcional na prática: o índice `categories_nome_modo_uniq`
   * é sobre (nome, pdv_mode), então "Bebidas" existe simultaneamente nas três
   * empresas. Sem o escopo, renomear "Bebidas" no SuperMax reescrevia a
   * categoria de todo produto e serviço chamado "Bebidas" na MaxLook e na
   * TechMax — corrupção silenciosa do dado de outra empresa.
   */
  renameCategory: async (
    id: string,
    nomeAntigo: string,
    nomeNovo: string,
    pdvMode?: Product['pdvMode'],
  ): Promise<void> => {
    const novo = nomeNovo.trim();
    const { error } = await supabase.from('categories').update({ name: novo }).eq('id', id);
    if (error) throw error;
    if (nomeAntigo && nomeAntigo !== novo) {
      await escopoFilial(
        supabase.from('products').update({ category: novo }).eq('category', nomeAntigo), pdvMode);
      await escopoFilial(
        supabase.from('services').update({ category: novo }).eq('category', nomeAntigo), pdvMode);
    }
  },

  /**
   * Quantos produtos/serviços usam este nome de categoria NESTA empresa.
   * Sem o escopo, excluir "Bebidas" na TechMax era barrado porque o SuperMax
   * tinha uma categoria de mesmo nome em uso.
   */
  countCategoryUsage: async (nome: string, pdvMode?: Product['pdvMode']): Promise<number> => {
    const [p, s] = await Promise.all([
      escopoFilial(
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('category', nome), pdvMode),
      escopoFilial(
        supabase.from('services').select('id', { count: 'exact', head: true }).eq('category', nome), pdvMode),
    ]);
    return (p.count ?? 0) + (s.count ?? 0);
  },

  upsertProduct: async (product: Product): Promise<void> => {
    const { created_at, pdvMode, ...row } = product as any;
    (row as any).pdv_mode = pdvMode ?? 'supermax';

    // Foto nova chega do formulário como data URL (é o que o preview usa).
    // Vira arquivo no Storage só aqui, no salvar: subir na hora da escolha
    // deixaria arquivo órfão toda vez que alguém cancela o cadastro.
    if (typeof row.image === 'string' && row.image.startsWith('data:')) {
      try {
        row.image = await enviarFotoProduto(row.image, row.pdv_mode, row.id);
      } catch (err) {
        // Sem o bucket (patch 2026-09-18b ainda não aplicado) ou com o
        // Storage fora, grava o base64 como sempre foi. O produto não pode
        // deixar de ser salvo por causa da foto; a migração recolhe depois.
        console.warn('[upsertProduct] foto não foi para o Storage, gravando base64', err);
      }
    } else if (!row.image) {
      // Foto removida no formulário: apaga o arquivo. Sem await e sem erro —
      // se não havia arquivo, não há o que apagar.
      supabase.storage.from(BUCKET_FOTOS_PRODUTO)
        .remove([caminhoFotoProduto(row.pdv_mode, row.id)])
        .catch(() => {});
    }

    const { error } = await supabase.from('products').upsert(row);
    if (error) throw error;
  },

  deleteProduct: async (id: string): Promise<void> => {
    // A URL da foto sai antes do DELETE: depois dele não há onde ler.
    const { data: antes } = await supabase.from('products').select('image').eq('id', id).maybeSingle();
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    const caminho = caminhoDaUrlFoto((antes as any)?.image);
    if (caminho) {
      supabase.storage.from(BUCKET_FOTOS_PRODUTO).remove([caminho]).catch(() => {});
    }
  },

  /**
   * Migração única: leva para o Storage as fotos que ainda estão em base64
   * na coluna `image`. Idempotente — só toca linha que ainda começa com
   * `data:`, então pode ser rodada de novo se parar no meio. Roda com a
   * sessão de quem chama (precisa enxergar as três empresas: Admin/CEO), e
   * cada troca fica na Auditoria em nome dessa pessoa.
   *
   * A migração TERMINOU (as 61 fotos estão no bucket, nenhuma linha em base64)
   * e a cópia dos originais, `products_image_backup`, foi apagada em
   * 2026-09-19 — não há mais para onde voltar. A função fica porque continua
   * correta e idempotente: serve para uma base recriada do zero, ou para o dia
   * em que alguém importar produto com foto embutida. Sem linha `data:` para
   * tocar, ela não faz nada.
   */
  migrarFotosProdutoParaStorage: async (): Promise<{ migradas: number; falhas: string[] }> => {
    const { data, error } = await supabase
      .from('products')
      .select('id, pdv_mode, image')
      .like('image', 'data:%');
    if (error) throw error;
    let migradas = 0;
    const falhas: string[] = [];
    for (const p of (data ?? []) as any[]) {
      try {
        const url = await enviarFotoProduto(p.image, p.pdv_mode ?? 'supermax', p.id);
        // Só troca se a linha ainda estiver em base64: se alguém salvou uma
        // foto nova no meio da migração, ela já virou URL e não é
        // sobrescrita. (Comparar com o base64 inteiro poria até 120 KB na
        // URL da requisição.)
        const { error: e } = await supabase.from('products')
          .update({ image: url }).eq('id', p.id).like('image', 'data:%');
        if (e) throw e;
        migradas++;
      } catch (err: any) {
        falhas.push(`${p.id}: ${err?.message ?? err}`);
      }
    }
    return { migradas, falhas };
  },

  /**
   * Migração única das fotos de cliente e fornecedor que ainda estão em base64.
   * Idempotente — só toca linha que começa com `data:`, então pode rodar de
   * novo se parar no meio. Mesmo desenho de `migrarFotosProdutoParaStorage`.
   *
   * Não houve tabela de backup desta vez: eram 3 fotos, 25 kB no total, e a
   * função é reversível na prática (o original continua na linha até o UPDATE
   * dar certo, porque o arquivo sobe primeiro).
   */
  migrarFotosCadastroParaStorage: async (): Promise<{ migradas: number; falhas: string[] }> => {
    let migradas = 0;
    const falhas: string[] = [];
    for (const [tabela, tipo] of [['clients', 'clientes'], ['suppliers', 'fornecedores']] as const) {
      const { data, error } = await supabase
        .from(tabela)
        .select('id, pdv_mode, image')
        .like('image', 'data:%');
      if (error) throw error;
      for (const linha of (data ?? []) as any[]) {
        try {
          const caminho = await enviarFotoCadastro(
            linha.image, linha.pdv_mode ?? 'supermax', tipo, linha.id);
          // Só troca se ainda estiver em base64: se alguém salvou foto nova no
          // meio da migração, ela já virou caminho e não é sobrescrita.
          const { error: e } = await supabase.from(tabela)
            .update({ image: caminho }).eq('id', linha.id).like('image', 'data:%');
          if (e) throw e;
          migradas++;
        } catch (err: any) {
          falhas.push(`${tabela}/${linha.id}: ${err?.message ?? err}`);
        }
      }
    }
    return { migradas, falhas };
  },

  // ─── Clientes ────────────────────────────────────────────
  getClients: async (pdvMode?: Client['pdvMode']): Promise<Client[]> => {
    const q = escopoFilial(supabase.from('clients').select('*'), pdvMode);
    const { data, error } = await q.order('name');
    if (error) throw error;
    const linhas = (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    })) as Client[];
    // Uma assinatura em lote para a lista toda. Esta leitura roda na abertura
    // de todo PDV, então uma requisição por cliente seria caro na turma.
    return resolverFotosCadastro(linhas);
  },

  upsertClient: async (client: Client): Promise<void> => {
    const { created_at, pdvMode, ...row } = client as any;
    (row as any).pdv_mode = pdvMode ?? 'supermax';
    // Foto nova chega como data URL (é o que o preview usa) e vira arquivo só
    // aqui, no salvar — subir na escolha deixaria órfão a cada desistência.
    if (typeof row.image === 'string' && row.image.startsWith('data:')) {
      row.image = await enviarFotoCadastro(row.image, row.pdv_mode, 'clientes', row.id);
    } else if (!row.image) {
      supabase.storage.from(BUCKET_CADASTROS)
        .remove([caminhoFotoCadastro(row.pdv_mode, 'clientes', row.id)])
        .catch(() => {});
    } else if (row.image.startsWith('http')) {
      // URL assinada lida na própria tela: NÃO regravar, senão a coluna passa a
      // guardar uma URL que expira em uma hora. Volta a ser o caminho.
      row.image = caminhoFotoCadastro(row.pdv_mode, 'clientes', row.id);
    }
    const { error } = await supabase.from('clients').upsert(row);
    if (error) throw error;
  },

  deleteClient: async (id: string): Promise<void> => {
    const { data: antes } = await supabase.from('clients')
      .select('image').eq('id', id).maybeSingle();
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) throw error;
    const caminho = caminhoDaFotoCadastro((antes as any)?.image);
    if (caminho) {
      supabase.storage.from(BUCKET_CADASTROS).remove([caminho]).catch(() => {});
    }
  },

  // ─── Fornecedores ────────────────────────────────────────
  getSuppliers: async (pdvMode?: string): Promise<any[]> => {
    const q = escopoFilial(supabase.from('suppliers').select('*'), pdvMode);
    const { data, error } = await q.order('name');
    if (error) throw error;
    const linhas = (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    }));
    return resolverFotosCadastro(linhas);
  },

  // Espelho exato de upsertClient — ver os porquês lá.
  upsertSupplier: async (supplier: any): Promise<void> => {
    const { created_at, pdvMode, ...row } = supplier;
    (row as any).pdv_mode = pdvMode ?? 'supermax';
    if (typeof row.image === 'string' && row.image.startsWith('data:')) {
      row.image = await enviarFotoCadastro(row.image, row.pdv_mode, 'fornecedores', row.id);
    } else if (!row.image) {
      supabase.storage.from(BUCKET_CADASTROS)
        .remove([caminhoFotoCadastro(row.pdv_mode, 'fornecedores', row.id)])
        .catch(() => {});
    } else if (row.image.startsWith('http')) {
      row.image = caminhoFotoCadastro(row.pdv_mode, 'fornecedores', row.id);
    }
    const { error } = await supabase.from('suppliers').upsert(row);
    if (error) throw error;
  },

  deleteSupplier: async (id: string): Promise<void> => {
    const { data: antes } = await supabase.from('suppliers')
      .select('image').eq('id', id).maybeSingle();
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
    const caminho = caminhoDaFotoCadastro((antes as any)?.image);
    if (caminho) {
      supabase.storage.from(BUCKET_CADASTROS).remove([caminho]).catch(() => {});
    }
  },

  // ─── Serviços ────────────────────────────────────────────
  // Mesmo mapeamento pdv_mode <-> pdvMode que products.
  // Mesmo escopo por empresa de getProducts. Sem ele, o contador de uso das
  // categorias somava os serviços das três lojas.
  getServices: async (pdvMode?: Service['pdvMode']): Promise<Service[]> => {
    const q = escopoFilial(supabase.from('services').select('*'), pdvMode);
    const { data, error } = await q.order('name');
    if (error) throw error;
    return (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    })) as Service[];
  },

  upsertService: async (service: Service): Promise<void> => {
    const { created_at, pdvMode, ...row } = service as any;
    (row as any).pdv_mode = pdvMode ?? 'supermax';
    const { error } = await supabase.from('services').upsert(row);
    if (error) throw error;
  },

  deleteService: async (id: string): Promise<void> => {
    const { error } = await supabase.from('services').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── Contas ──────────────────────────────────────────────
  // Mesmo escopo por empresa de products/services/sales: a conta de aluguel
  // da MaxLook não é a do SuperMax.
  getAccounts: async (pdvMode?: Account['pdvMode']): Promise<Account[]> => {
    const q = escopoFilial(supabase.from('accounts').select('*'), pdvMode);
    const { data, error } = await q.order('dueDate', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(({ pdv_mode, ...r }: any) => ({
      ...r,
      pdvMode: pdv_mode ?? 'supermax',
    })) as Account[];
  },

  upsertAccount: async (account: Account): Promise<void> => {
    const { created_at, pdvMode, ...row } = account as any;
    (row as any).pdv_mode = pdvMode ?? 'supermax';
    const { error } = await supabase.from('accounts').upsert(row);
    if (error) throw error;
  },

  deleteAccount: async (id: string): Promise<void> => {
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── Agendamentos ────────────────────────────────────────
  getAppointments: async (): Promise<Appointment[]> => {
    const { data, error } = await supabase.from('appointments').select('*').order('date');
    if (error) throw error;
    return (data ?? []) as any[];
  },

  upsertAppointment: async (appointment: any): Promise<void> => {
    const { created_at, ...row } = appointment;
    const { error } = await supabase.from('appointments').upsert(row);
    if (error) throw error;
  },

  deleteAppointment: async (id: any): Promise<void> => {
    const { error } = await supabase.from('appointments').delete().eq('id', String(id));
    if (error) throw error;
  },

  // ─── Fichas ──────────────────────────────────────────────
  getFichas: async (): Promise<any[]> => {
    const { data, error } = await supabase
      .from('event_fichas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  upsertFicha: async (ficha: any): Promise<void> => {
    const { created_at, ...row } = ficha;
    const { error } = await supabase.from('event_fichas').upsert(row);
    if (error) throw error;
  },

  deleteFicha: async (id: any): Promise<void> => {
    const { error } = await supabase.from('event_fichas').delete().eq('id', String(id));
    if (error) throw error;
  },

  // ─── Vendas ──────────────────────────────────────────────
  // `pdvMode` filtra NO SERVIDOR. Cada venda arrasta sale_items e
  // sale_payments junto, então trazer as três empresas para exibir uma só é
  // caro — e, no Fiscal, era também errado: a lista de NFC-e mostrava cupom
  // das outras lojas. Sem argumento continua trazendo tudo, que é o que as
  // telas com filtro no cliente ainda esperam.
  getSales: async (pdvMode?: Sale['pdvMode']): Promise<Sale[]> => {
    const q = escopoFilial(
      supabase.from('sales').select('*, sale_items(*), sale_payments(*)'), pdvMode);
    const { data, error } = await q.order('date', { ascending: false });
    if (error) throw error;

    return (data ?? []).map(mapSaleRow);
  },

  // Vendas só com o que o Estoque desenha: data e, de cada item, nome e
  // quantidade (a "movimentação"). getSales traz as três tabelas com todas as
  // colunas — pagamento, custo, EAN, campos de nicho — e o Estoque não usa
  // nenhuma. Como a tela recarrega a cada venda, é o payload que mais se repete.
  // Só as `limite` vendas mais recentes: a tela mostra as 10 últimas
  // movimentações, e o total de "Movimentações" vem de resumoSaidasEstoque.
  getSalesMovimentacao: async (pdvMode: Sale['pdvMode'], limite: number): Promise<Sale[]> => {
    const q = escopoFilial(
      supabase.from('sales').select('id, date, total, status, pdv_mode, sale_items(name, quantity)'), pdvMode);
    const { data, error } = await q.order('date', { ascending: false }).limit(limite);
    if (error) throw error;
    return (data ?? []).map(mapSaleRow);
  },

  // Recorte da lista de vendas do Financeiro. Sem período, as mais recentes;
  // com período (o filtro de datas da tela), as desse intervalo — senão
  // filtrar um mês antigo mostraria lista vazia, porque o recorte recente não
  // chega lá. `ate` é inclusivo, como no filtro da tela: vai até o fim do dia.
  getSalesRecorte: async (
    pdvMode: Sale['pdvMode'],
    opts: { limite: number; de?: string; ate?: string },
  ): Promise<Sale[]> => {
    let q = escopoFilial(
      supabase.from('sales').select('*, sale_items(*), sale_payments(*)'), pdvMode);
    if (opts.de) q = q.gte('date', opts.de);
    if (opts.ate) {
      const fim = new Date(`${opts.ate}T00:00:00Z`);
      fim.setUTCDate(fim.getUTCDate() + 1);
      q = q.lt('date', fim.toISOString());
    }
    const { data, error } = await q.order('date', { ascending: false }).limit(opts.limite);
    if (error) throw error;
    return (data ?? []).map(mapSaleRow);
  },

  // Cartões do Financeiro somados no banco (patch 2026-09-18c): desde o
  // início, menos as vendas ocultadas na tela. Nenhuma venda trafega.
  resumoVendas: async (
    pdvMode: Sale['pdvMode'],
    ocultas: string[],
  ): Promise<{ total: number; quantidade: number }> => {
    const { data, error } = await supabase.rpc('resumo_vendas', { p_pdv_mode: pdvMode, p_ocultas: ocultas });
    if (error) throw error;
    const r = (data as any[])?.[0] ?? {};
    return { total: Number(r.total ?? 0), quantidade: Number(r.quantidade ?? 0) };
  },

  // "Movimentações" do Estoque contada no banco. `ocultas` são as chaves
  // `<venda>-<posição>` que a tela guarda; volta quantas delas valem nesta
  // empresa, que é o número do botão "restaurar".
  // Histórico do "Editar estoque" (patch 2026-09-23). Antes o ajuste só
  // sobrescrevia products.stock e não deixava rastro.
  registrarAjusteEstoque: async (ajuste: {
    productId: string; productName: string; pdvMode: string;
    tipo: 'entrada' | 'saida' | 'correcao';
    saldoAnterior: number; saldoNovo: number;
  }): Promise<void> => {
    const { error } = await supabase.from('estoque_ajustes').insert({
      product_id: ajuste.productId,
      product_name: ajuste.productName,
      pdv_mode: ajuste.pdvMode,
      tipo: ajuste.tipo,
      quantidade: ajuste.saldoNovo - ajuste.saldoAnterior,
      saldo_anterior: ajuste.saldoAnterior,
      saldo_novo: ajuste.saldoNovo,
    });
    if (error) throw error;
  },

  getAjustesEstoque: async (pdvMode: string, limite: number): Promise<AjusteEstoque[]> => {
    const { data, error } = await supabase.from('estoque_ajustes')
      .select('id, product_name, tipo, quantidade, created_at')
      .eq('pdv_mode', pdvMode)
      .order('created_at', { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      productName: r.product_name,
      tipo: r.tipo,
      quantidade: Number(r.quantidade),
      criadoEm: r.created_at,
    }));
  },

  /** Ajustes da empresa: o total e quantos sobram tirando os que a pessoa
   *  ocultou (os ids ocultos podem ser de outra empresa, daí a subtração). */
  contarAjustesEstoque: async (pdvMode: string, ocultos: string[]): Promise<{ total: number; visiveis: number }> => {
    const contar = async (excluir: string[]) => {
      let q = supabase.from('estoque_ajustes')
        .select('id', { count: 'exact', head: true })
        .eq('pdv_mode', pdvMode);
      if (excluir.length) q = q.not('id', 'in', `(${excluir.join(',')})`);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    };
    const total = await contar([]);
    return { total, visiveis: ocultos.length ? await contar(ocultos) : total };
  },

  resumoSaidasEstoque: async (
    pdvMode: Sale['pdvMode'],
    ocultas: string[],
  ): Promise<{ total: number; ocultas: number }> => {
    const { data, error } = await supabase.rpc('resumo_saidas_estoque', { p_pdv_mode: pdvMode, p_ocultas: ocultas });
    if (error) throw error;
    const r = (data as any[])?.[0] ?? {};
    return { total: Number(r.total ?? 0), ocultas: Number(r.ocultas ?? 0) };
  },

  // saveSale foi REMOVIDA em 2026-09-01.
  //
  // Era codigo morto — nenhuma tela a chamava — e uma armadilha esperando:
  // ela inseria em `sales` sem `sessionId`, entao qualquer venda gravada por
  // ela ficaria orfa de caixa. O fechamento nao a somaria, `getCashSalesTotal`
  // nao a veria, e a conferencia do turno fecharia errado sem ninguem
  // entender por que. Alem disso nao passava por finalize_sale_atomic, ou
  // seja, nao travava estoque nem debitava fiado na mesma transacao.
  //
  // O caminho unico e correto e a RPC `finalize_sale_atomic` (ver PDVModule):
  // insere venda + itens + pagamentos, baixa estoque com lock ordenado e
  // debita fiado, tudo num bloco so.

  // ─── Parcelas de Crédito ─────────────────────────────────
  getInstallmentsBySale: async (saleId: string): Promise<CreditInstallment[]> => {
    const { data, error } = await supabase
      .from('credit_installments')
      .select('*')
      .eq('sale_id', saleId)
      .order('installment_number');
    if (error) throw error;
    return (data ?? []) as CreditInstallment[];
  },

  // Parcelas de várias vendas numa consulta só, agrupadas por venda. O
  // relatório do Financeiro fazia uma ida ao banco POR venda a crédito.
  getInstallmentsBySales: async (saleIds: string[]): Promise<Record<string, CreditInstallment[]>> => {
    const porVenda: Record<string, CreditInstallment[]> = {};
    if (saleIds.length === 0) return porVenda;
    const { data, error } = await supabase
      .from('credit_installments')
      .select('*')
      .in('sale_id', saleIds)
      .order('installment_number');
    if (error) throw error;
    for (const row of (data ?? []) as CreditInstallment[]) {
      (porVenda[row.sale_id] ??= []).push(row);
    }
    return porVenda;
  },

  createInstallments: async (installments: CreditInstallment[]): Promise<void> => {
    const { error } = await supabase.from('credit_installments').insert(installments);
    if (error) throw error;
  },

  payInstallment: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('credit_installments')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // ─── Usuários / Autenticação ──────────────────────────────
  // SEM `avatar` de propósito: a coluna guarda a foto em base64 e a tabela
  // inteira pesa ~5 MB por causa dela. Nenhuma tela que lista usuários
  // (Cadastros, Configurações, Folha, troca de operador no PDV) exibe a foto
  // dos outros — só o nome. Trazer `select('*')` fazia o picker de troca de
  // operador baixar 5 MB antes de abrir. Quem precisa da foto de UM usuário
  // usa getUserAvatar.
  // pdvMode filtra a EQUIPE por empresa. A RLS ja corta o que nao e visivel,
  // mas o Admin Master enxerga todo mundo — sem este filtro ele veria os
  // operadores das tres lojas misturados na tela de Usuarios.
  getUsers: async (pdvMode?: string | null): Promise<User[]> => {
    let q = supabase
      .from('user_profiles')
      .select('id, email, name, role, parentId, lojas');
    if (pdvMode) q = q.contains('lojas', [pdvMode]);
    const { data, error } = await q.order('name');
    if (error) throw error;
    return (data ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      parentId: p.parentId,
      lojas: p.lojas ?? [],
    })) as User[];
  },

  /** Foto de um único usuário, pronta para o `<img>`. Existe para getUsers
   *  poder ser leve — quem lista gente não carrega rosto de ninguém. */
  getUserAvatar: async (userId: string): Promise<string | undefined> => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('avatar')
      .eq('id', userId)
      .single();
    if (error) return undefined;
    return urlDoAvatar((data as any)?.avatar);
  },

  // `loja` define a EMPRESA do novo usuario: criado no SuperMax, e do
  // SuperMax.
  //
  // O cadastro tem DOIS passos, e desde o patch 2026-09-03_seguranca_parte5
  // isso e proposital. O signUp roda dentro do Auth, onde nao existe sessao:
  // o banco nao consegue distinguir esta tela de um estranho batendo em
  // /auth/v1/signup com a chave publica. Por isso o trigger handle_new_user
  // ignora cargo e empresa — todo mundo nasce Operador de Caixa sem empresa,
  // que nao enxerga nada — e quem decide e a RPC provisionar_usuario, ja com
  // a sessao do admin restaurada e o nivel dele conferido no servidor.
  createUser: async (
    email: string,
    password: string,
    name: string,
    role: string,
    parentId?: string,
    loja?: string | null,
  ): Promise<User> => {
    // Antes de qualquer coisa: senha curta ou vazada nem chega no Auth. Vem
    // primeiro de propósito — recusar aqui não deixa usuário meio-criado,
    // porque o signUp ainda não rodou. (Ver `senhaSegura`: o Supabase só
    // oferece essa trava no plano Pro.)
    await exigirSenhaSegura(password);

    // Preserva a sessão do admin antes do signUp
    const { data: { session: adminSession } } = await supabase.auth.getSession();

    // Só `name` vai no metadata: é rótulo, não concede nada. Cargo e empresa
    // não viajam por aqui — quem os manda é o passo 2, autenticado.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });

    if (error) throw error;
    if (!data.user) throw new Error('Falha ao criar usuário');

    // Restaura a sessão do admin imediatamente
    if (adminSession) {
      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    } else {
      // Sem a sessão do admin o passo 2 seria recusado pelo servidor, e a
      // conta ficaria criada porém inerte. Melhor falhar dizendo isso.
      throw new Error(
        'Sessão do administrador perdida durante o cadastro. A conta foi criada ' +
        'sem cargo nem empresa — entre de novo e conclua o cadastro na tela de Usuários.'
      );
    }

    // Passo 2: cargo e empresa, agora com quem está pedindo identificado.
    const { error: provisionErr } = await supabase.rpc('provisionar_usuario', {
      p_user_id: data.user.id,
      p_role: role,
      p_loja: loja ?? null,
      p_parent_id: parentId ?? null,
    });
    if (provisionErr) throw provisionErr;

    return {
      id: data.user.id,
      email: data.user.email ?? email,
      name,
      role: role as any,
      parentId,
    } as User;
  },

  /**
   * Devolve a foto já resolvida (URL assinada) quando mexeu nela; `undefined`
   * quando não mexeu ou quando a foto foi removida.
   *
   * A foto só é tocada se a CHAVE `avatar` vier no objeto — não basta o valor
   * ser `undefined`. A distinção é necessária: a tela de Usuários salva
   * `{ name, role }` e não pode apagar a foto de ninguém sem querer, enquanto a
   * tela de perfil manda `avatar: undefined` justamente para removê-la.
   */
  updateUserProfile: async (userId: string, fields: Partial<User>): Promise<string | undefined> => {
    const row: Record<string, unknown> = { name: fields.name, role: fields.role };
    let resolvida: string | undefined;

    if ('avatar' in fields) {
      const valor = fields.avatar;
      if (typeof valor === 'string' && valor.startsWith('data:')) {
        // Foto nova: vira arquivo aqui, no salvar. Subir na hora de escolher
        // deixaria arquivo órfão toda vez que alguém desiste — mesmo motivo de
        // `upsertProduct`.
        row.avatar = await enviarAvatar(valor, userId);
        resolvida = await urlDoAvatar(row.avatar as string);
      } else if (!valor) {
        // Removeu: apaga o arquivo e zera a coluna. Sem await e sem erro — se
        // não havia arquivo, não há o que apagar.
        supabase.storage.from(BUCKET_AVATARES).remove([userId]).catch(() => {});
        row.avatar = null;
      } else {
        // Já é caminho ou URL legada: passa direto, sem reenviar.
        row.avatar = valor;
        resolvida = await urlDoAvatar(valor);
      }
    }

    const { error } = await supabase.from('user_profiles').update(row).eq('id', userId);
    if (error) throw error;
    return resolvida;
  },

  // Deleta o usuário POR COMPLETO — auth.users cascateia pro
  // user_profiles. Backend: delete_user_completely RPC (patch
  // 2026-07-20_delete_user_completely.sql). Só admin/gerente_* podem;
  // auto-deleção bloqueada.
  deleteUser: async (userId: string): Promise<void> => {
    const { error } = await supabase.rpc('delete_user_completely', { p_user_id: userId });
    if (error) throw error;
  },

  // Tira a pessoa de UMA empresa, sem apagar a conta dela.
  //
  // A mesma pessoa pode operar em mais de uma loja, e ela e UM registro so —
  // entao a lixeira na lista da MaxLook nao pode apagar quem tambem atende o
  // SuperMax. Retorna 'ultima_empresa' quando aquela e a unica que ele tem:
  // ai nao ha o que remover, e a tela oferece excluir a conta.
  removerUsuarioDaEmpresa: async (
    userId: string,
    loja: string,
  ): Promise<'removido' | 'ultima_empresa'> => {
    const { data, error } = await supabase.rpc('remover_usuario_da_empresa', {
      p_user_id: userId,
      p_loja: loja,
    });
    if (error) throw error;
    return data === 'ultima_empresa' ? 'ultima_empresa' : 'removido';
  },

  adicionarUsuarioNaEmpresa: async (userId: string, loja: string): Promise<void> => {
    const { error } = await supabase.rpc('adicionar_usuario_na_empresa', {
      p_user_id: userId,
      p_loja: loja,
    });
    if (error) throw error;
  },

  getSession: async (): Promise<User | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    // Tenta buscar o profile. Se a query falhar (rede, cold-start,
    // RLS transitório), fazemos 1 retry curto — Ctrl+Shift+R hard reload
    // frequentemente cai na primeira request antes do cliente estar quente.
    // Colunas explícitas, não `*`. Esta consulta está no caminho do boot e
    // roda de novo a cada TOKEN_REFRESHED (de hora em hora, em todo terminal),
    // então tudo que entrar na linha entra junto. Com `*`, uma coluna nova
    // criada amanhã passa a ser baixada aqui sem ninguém decidir isso.
    //
    // `avatar` vem, mas desde o patch 2026-09-19c a coluna guarda o CAMINHO no
    // Storage, não mais a imagem. Era ela o peso real daqui: ~40 KB de base64
    // por operador, em toda abertura e em todo refresh de token — 50 terminais
    // baixando isso de hora em hora. Agora são poucos bytes, e a URL assinada
    // sai depois, só para quem tem foto.
    const fetchProfile = async () => {
      return await supabase
        .from('user_profiles')
        .select('name, role, avatar, parentId, lojas')
        .eq('id', session.user.id)
        .single();
    };

    let { data: profile, error } = await fetchProfile();
    if ((!profile || error) && !error?.message?.includes('multiple')) {
      await new Promise(r => setTimeout(r, 250));
      ({ data: profile, error } = await fetchProfile());
    }

    if (profile) {
      return {
        id: session.user.id,
        email: session.user.email ?? '',
        name: profile.name,
        role: profile.role,
        // Caminho -> URL assinada. Sem foto não há requisição nenhuma.
        avatar: await urlDoAvatar(profile.avatar),
        parentId: profile.parentId,
        // Sem `lojas` aqui o FilialContext nao sabe quais empresas este
        // usuario opera, e o Operador de Caixa cairia no seletor das tres
        // em vez de entrar direto na dele.
        lojas: profile.lojas ?? [],
      } as User;
    }

    // Profile falhou depois de retry. Session é válida — usar user_metadata
    // como fallback (name/role/parentId ficam salvos ali no signUp).
    // Deslogar aqui bounceia o operador pra Login mesmo com auth válido,
    // o que é o pior UX possível — melhor tentar seguir com o metadata.
    const meta = (session.user.user_metadata ?? {}) as Record<string, any>;
    if (meta.name && meta.role) {
      // eslint-disable-next-line no-console
      console.warn('[Storage.getSession] Profile fetch failed, usando user_metadata como fallback', error);
      return {
        id: session.user.id,
        email: session.user.email ?? '',
        name: meta.name,
        role: meta.role,
        avatar: meta.avatar,
        parentId: meta.parentId ?? undefined,
      } as User;
    }

    // Sem profile nem metadata utilizável — session órfã (usuário
    // deletado do user_profiles mas com auth.user ainda vivo). Aí sim
    // é seguro deslogar.
    // eslint-disable-next-line no-console
    console.error('[Storage.getSession] Session sem profile nem metadata', error);
    return null;
  },

  getCurrentUser: async (): Promise<User | null> => Storage.getSession(),

  // setCurrentUser saiu em 2026-09-19c. Era `updateUserProfile(user.id, user)`,
  // e passar o User INTEIRO virou armadilha quando a foto foi para o Storage:
  // o objeto sempre carrega a chave `avatar`, então toda gravação de perfil
  // mexia na foto — inclusive para reenviar ao Storage a URL assinada que
  // acabara de ser lida. Quem salva perfil agora chama `updateUserProfile`
  // dizendo explicitamente quais campos está mudando.

  login: async (email: string, password: string): Promise<User | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) return null;

    // Mesmas colunas de getSession, pelo mesmo motivo.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('name, role, avatar, parentId, lojas')
      .eq('id', data.user.id)
      .single();

    if (!profile) return null;

    return {
      id: data.user.id,
      email: data.user.email ?? '',
      name: profile.name,
      role: profile.role,
      avatar: await urlDoAvatar(profile.avatar),
      parentId: profile.parentId,
      lojas: profile.lojas ?? [],
    } as User;
  },

  logout: async (): Promise<void> => {
    await supabase.auth.signOut();
  },

  // ─── Caixa: sessões + movimentos (sangria/suprimento) ────
  // O caixa e POR LOJA. Sem o pdvMode aqui, o operador abria o caixa no
  // SuperMax e o mesmo caixa aparecia aberto na aba da MaxLook — sangria,
  // suprimento e fechamento caiam todos na mesma gaveta.
  getOpenSession: async (operadorId: string, pdvMode: CashSession['pdvMode'] = 'supermax'): Promise<CashSession | null> => {
    const { data, error } = await supabase
      .from('cash_sessions')
      .select('*')
      .eq('operadorId', operadorId)
      .eq('pdv_mode', pdvMode)
      .eq('status', 'aberto')
      .order('aberturaAt', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...(data as any), pdvMode: (data as any).pdv_mode ?? 'supermax' } as CashSession;
  },

  openCashSession: async (
    operadorId: string,
    fundoTroco: number,
    pdvMode: CashSession['pdvMode'] = 'supermax',
  ): Promise<CashSession> => {
    const session: CashSession = {
      id: crypto.randomUUID(),
      operadorId,
      pdvMode,
      aberturaAt: new Date().toISOString(),
      fundoTroco,
      status: 'aberto',
    };
    // pdvMode (camelCase) -> pdv_mode (coluna), como em products/sales.
    const { pdvMode: _m, ...row } = session as any;
    const { error } = await supabase
      .from('cash_sessions')
      .insert({ ...row, pdv_mode: pdvMode });
    if (error) throw error;
    return session;
  },

  closeCashSession: async (
    sessionId: string,
    dinheiroContado: number,
    observacao?: string,
  ): Promise<void> => {
    const { error } = await supabase
      .from('cash_sessions')
      .update({
        status: 'fechado',
        fechamentoAt: new Date().toISOString(),
        dinheiroContado,
        observacao: observacao ?? null,
      })
      .eq('id', sessionId);
    if (error) throw error;
  },

  addCashMovement: async (
    sessionId: string,
    operadorId: string,
    tipo: 'sangria' | 'suprimento',
    valor: number,
    motivo: string,
  ): Promise<CashMovement> => {
    const mov: CashMovement = {
      id: crypto.randomUUID(),
      sessionId,
      tipo,
      valor,
      motivo,
      operadorId,
      createdAt: new Date().toISOString(),
    };
    const { error } = await supabase.from('cash_movements').insert({
      id: mov.id,
      sessionId: mov.sessionId,
      tipo: mov.tipo,
      valor: mov.valor,
      motivo: mov.motivo,
      operadorId: mov.operadorId,
    });
    if (error) throw error;
    return mov;
  },

  getMovementsBySession: async (sessionId: string): Promise<CashMovement[]> => {
    const { data, error } = await supabase
      .from('cash_movements')
      .select('*')
      .eq('sessionId', sessionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((m: any) => ({
      id: m.id,
      sessionId: m.sessionId,
      tipo: m.tipo,
      valor: Number(m.valor),
      motivo: m.motivo ?? '',
      operadorId: m.operadorId,
      createdAt: m.created_at,
    })) as CashMovement[];
  },

  // Última venda concluída pelo operador (preferindo a sessão atual, se houver)
  // Estorna uma venda finalizada: devolve estoque, cancela dívida em fiado,
  // marca status='reversed'. Backend: reverse_sale_atomic RPC (patch
  // 2026-07-20_reverse_sale_atomic.sql). Idempotente na server-side.
  reverseSale: async (saleId: string): Promise<void> => {
    const { error } = await supabase.rpc('reverse_sale_atomic', { p_sale_id: saleId });
    if (error) throw error;
  },

  // Busca vendas por prefixo do id (uso: reimpressão por número de cupom).
  // Case-insensitive. Retorna no máximo 10 matches, mais recentes primeiro.
  // pdvMode: a busca alimenta a TROCA/DEVOLUCAO. Sem escopo, digitar o
  // prefixo de um cupom do SuperMax no PDV da MaxLook achava a venda e
  // devolvia mercadoria de outra empresa ao estoque errado.
  getSalesByIdPrefix: async (
    prefix: string,
    limit: number = 10,
    pdvMode?: Sale['pdvMode'],
  ): Promise<Sale[]> => {
    const p = prefix.trim();
    if (p.length < 4) return [];
    const q = escopoFilial(supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .ilike('id', `${p.toLowerCase()}%`), pdvMode);
    const { data, error } = await q
      .order('date', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(mapSaleRow);
  },

  // pdvMode: reimpressao do MaxLook nao deve listar cupom do SuperMax.
  // Omitido => todos os PDVs (comportamento anterior ao patch 2026-08-17).
  getRecentSalesForReprint: async (
    operadorId: string,
    sessionId?: string | null,
    limit: number = 10,
    pdvMode?: string,
  ): Promise<Sale[]> => {
    let q = supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .eq('vendedorId', operadorId)
      .eq('status', 'completed')
      .order('date', { ascending: false })
      .limit(limit);
    if (sessionId) q = q.eq('sessionId', sessionId);
    if (pdvMode) q = q.eq('pdv_mode', pdvMode);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapSaleRow);
  },

  // Devolucao/troca busca a venda pelos 6 ultimos caracteres do id impresso
  // no recibo. `id` e TEXT (uuid gerado no cliente), entao ilike com sufixo
  // resolve sem precisar de coluna extra. Escopado por PDV pra uma filial nao
  // estornar cupom da outra.
  getSaleByShortId: async (shortId: string, pdvMode?: string): Promise<Sale | null> => {
    let q = supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .ilike('id', `%${shortId}`)
      .eq('status', 'completed')
      .limit(2);
    if (pdvMode) q = q.eq('pdv_mode', pdvMode);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];
    // Sufixo de 6 chars nao e unico por construcao. Com mais de um match o
    // operador precisa do id completo — devolver o "primeiro" estornaria a
    // venda errada.
    if (rows.length !== 1) return null;
    return mapSaleRow(rows[0]);
  },

  getLastSaleForReprint: async (operadorId: string, sessionId?: string | null): Promise<Sale | null> => {
    let q = supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .eq('vendedorId', operadorId)
      .eq('status', 'completed')
      .order('date', { ascending: false })
      .limit(1);
    if (sessionId) q = q.eq('sessionId', sessionId);
    const { data, error } = await q;
    if (error) throw error;
    const row: any = (data ?? [])[0];
    if (!row) return null;
    return mapSaleRow(row);
  },

  // ─── Auditoria ───────────────────────────────────────────
  // `pdvMode` e obrigatorio na pratica: sem ele a tela de Auditoria mostrava o
  // rastro das TRES empresas numa lista so. A RLS nao ajuda aqui — audit_log
  // so tem policy de nivel (>= 80), e todo usuario de hoje e gestao.
  // Registros anteriores ao patch 2026-09-06b que perderam a origem (o
  // registro auditado foi excluido antes de `pdv_mode` existir) ficam de fora:
  // sao 6, todos de exclusoes de 2026-07/08.
  getAuditLog: async (filters?: {
    entityType?: string;
    userId?: string;
    action?: 'insert' | 'update' | 'delete';
    from?: string;
    to?: string;
    limit?: number;
    pdvMode?: string | null;
  }): Promise<AuditLogEntry[]> => {
    let q = supabase
      .from('audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(filters?.limit ?? 200);
    if (filters?.pdvMode)    q = q.eq('pdv_mode', filters.pdvMode);
    if (filters?.entityType) q = q.eq('entity_type', filters.entityType);
    if (filters?.userId)     q = q.eq('user_id', filters.userId);
    if (filters?.action)     q = q.eq('action', filters.action);
    if (filters?.from)       q = q.gte('changed_at', filters.from);
    if (filters?.to)         q = q.lte('changed_at', filters.to);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as AuditLogEntry[];
  },

  // Soma de pagamentos em dinheiro das vendas vinculadas à sessão
  getCashSalesTotal: async (sessionId: string): Promise<number> => {
    const { data, error } = await supabase
      .from('sales')
      .select('id, sale_payments(method, amount)')
      .eq('sessionId', sessionId)
      .eq('status', 'completed');
    if (error) throw error;
    let total = 0;
    for (const sale of (data ?? []) as any[]) {
      for (const p of (sale.sale_payments ?? [])) {
        if (p.method === 'dinheiro') total += Number(p.amount);
      }
    }
    return total;
  },

  // ─── Folha de Pagamento / MaxBank ─────────────────────────
  getFolhas: async (mesRef?: string): Promise<FolhaPagamento[]> => {
    let q = supabase.from('folha_pagamento').select('*').eq('ativo', true).order('created_at', { ascending: false });
    if (mesRef) q = q.eq('mes_ref', mesRef);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as FolhaPagamento[];
  },

  upsertFolha: async (folha: Partial<FolhaPagamento> & { id?: string }): Promise<FolhaPagamento> => {
    const row = { ...folha, id: folha.id ?? crypto.randomUUID() };
    const { data, error } = await supabase.from('folha_pagamento').upsert(row).select().single();
    if (error) throw error;
    return data as FolhaPagamento;
  },

  deleteFolha: async (id: string): Promise<void> => {
    const { error } = await supabase.from('folha_pagamento').update({ ativo: false }).eq('id', id);
    if (error) throw error;
  },

  // Marca a folha como Paga e credita o líquido na conta MaxBank
  // do colaborador via RPC (idempotente).
  pagarFolha: async (folhaId: string): Promise<void> => {
    const { error: updateErr } = await supabase
      .from('folha_pagamento')
      .update({ status: 'Paga', paid_at: new Date().toISOString() })
      .eq('id', folhaId);
    if (updateErr) throw updateErr;

    const { error: rpcErr } = await supabase.rpc('creditar_folha_maxbank', { p_folha_id: folhaId });
    if (rpcErr) throw rpcErr;
  },

  getMaxbankConta: async (colaboradorId: string): Promise<MaxbankConta | null> => {
    const { data, error } = await supabase
      .from('maxbank_contas')
      .select('*')
      .eq('colaborador_id', colaboradorId)
      .maybeSingle();
    if (error) throw error;
    return (data as MaxbankConta | null) ?? null;
  },

  // ─── Promoções ────────────────────────────────────────────
  // Preço promocional NÃO é decisão do caixa: a oferta é proposta, aprovada
  // pela gestão, e é a aprovação que troca o preço do produto. Aqui só ficam
  // as chamadas; as regras (quem aprova, o que muda, quando volta) moram nas
  // RPCs, que são as mesmas para qualquer tela que venha depois.
  getPromocoes: async (pdvMode?: Product['pdvMode']): Promise<Promocao[]> => {
    const q = escopoFilial(supabase.from('promocoes').select('*'), pdvMode);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name ?? '',
      priceBefore: Number(r.price_before ?? 0),
      promoPrice: Number(r.promo_price ?? 0),
      startDate: r.start_date,
      endDate: r.end_date,
      description: r.description,
      status: r.status,
      pdvMode: r.pdv_mode ?? 'supermax',
      createdByName: r.created_by_name,
      parecerFinanceiro: r.parecer_financeiro,
      margemPct: r.margem_pct != null ? Number(r.margem_pct) : null,
      analisadoPorNome: r.analisado_por_nome,
      analisadoEm: r.analisado_em,
      decidedByName: r.decided_by_name,
      decidedAt: r.decided_at,
      observacao: r.observacao,
      createdAt: r.created_at,
    })) as Promocao[];
  },

  // O PDV lê a VIEW, não a tabela: ela traz só de/por/vigência e já recorta a
  // loja de quem consulta.
  getOfertasVigentes: async (pdvMode?: Product['pdvMode']): Promise<OfertaVigente[]> => {
    const q = escopoFilial(supabase.from('v_promocao_vigente').select('product_id, preco_de, preco_por'), pdvMode);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      productId: r.product_id,
      precoDe: Number(r.preco_de ?? 0),
      precoPor: Number(r.preco_por ?? 0),
    }));
  },

  criarPromocao: async (p: {
    productId: string; productName: string; priceBefore: number; promoPrice: number;
    startDate: string; endDate: string; description?: string;
    pdvMode: string; createdBy?: string | null; createdByName?: string | null;
  }): Promise<void> => {
    const { error } = await supabase.from('promocoes').insert({
      product_id: p.productId,
      product_name: p.productName,
      price_before: p.priceBefore,
      promo_price: p.promoPrice,
      start_date: p.startDate,
      end_date: p.endDate,
      description: p.description ?? null,
      pdv_mode: p.pdvMode,
      created_by: p.createdBy ?? null,
      created_by_name: p.createdByName ?? null,
    });
    if (error) throw error;
  },

  // Passo 1 — parecer de viabilidade. O banco calcula a margem que sobra no
  // preço promocional; o texto é obrigatório porque é o que a gestão lê.
  analisarPromocao: async (id: string, parecer: string): Promise<{ margem: number | null }> => {
    const { data, error } = await supabase.rpc('analisar_promocao', { p_id: id, p_parecer: parecer });
    if (error) throw error;
    const m = (data as any)?.margem_pct;
    return { margem: m != null ? Number(m) : null };
  },

  aprovarPromocao: async (id: string, observacao?: string): Promise<void> => {
    const { error } = await supabase.rpc('aprovar_promocao', { p_id: id, p_observacao: observacao ?? null });
    if (error) throw error;
  },

  reprovarPromocao: async (id: string, motivo: string): Promise<void> => {
    const { error } = await supabase.rpc('reprovar_promocao', { p_id: id, p_motivo: motivo });
    if (error) throw error;
  },

  excluirPromocao: async (id: string): Promise<void> => {
    const { error } = await supabase.from('promocoes').delete().eq('id', id);
    if (error) throw error;
  },

  // Chamada quando o app abre: devolve o preço das ofertas que venceram. É
  // idempotente — o MaxPOS não tem cron, e o preço só precisa estar certo
  // quando alguém está operando.
  reverterPromocoesExpiradas: async (): Promise<number> => {
    const { data, error } = await supabase.rpc('reverter_promocoes_expiradas');
    if (error) throw error;
    return Number(data ?? 0);
  },

  getMaxbankExtrato: async (contaId: string): Promise<MaxbankTransacao[]> => {
    const { data, error } = await supabase
      .from('maxbank_transacoes')
      .select('*')
      .eq('conta_id', contaId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as MaxbankTransacao[];
  },
};
