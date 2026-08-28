// Busca de produto compartilhada entre os PDVs (SuperMax, MaxLook, TechMax).
//
// Existe porque as telas de PDV filtravam com `.includes()`, que casa
// substring em QUALQUER posição: digitar "ca" trazia ma[ca]rrão junto com café,
// e "c" trazia quase todo o catálogo. Num PDV isso é ruído puro — o operador
// digita o começo do nome ou bipa o código, nunca o miolo da palavra.
//
// Regra aqui: casamento por PREFIXO — de nome, de palavra do nome, de ref
// ou de EAN. Portado do LogMax (src/lib/produtoBusca.ts) para manter os dois
// PDVs com a mesma gramática de busca.

// Acentos: "feijão" digitado precisa casar com "FEIJAO" cadastrado, e vice-versa.
// Regex via constructor pra evitar dúvida de encoding do arquivo.
const ACCENT_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');

/** lowercase + sem acento, para comparação de busca. */
export const normalizarBusca = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(ACCENT_REGEX, '').toLowerCase();

/** Normaliza uma categoria para uso como chave de agrupamento (chip). */
export const chaveCategoria = (c: unknown): string => normalizarBusca(c).trim();

// Separadores de palavra em nome de produto: espaço, hífen, barra, ponto,
// vírgula e parênteses. "Leite Integral 1L" -> ['leite','integral','1l'].
const PALAVRA_SPLIT = new RegExp('[\\s\\-/.,()]+');

export interface ProdutoBuscavel {
  name?: string | null;
  ref?: string | null;
  ean13?: string | null;
  marca?: string | null;
}

// A partir de quantas letras vale procurar no MIOLO do nome (palavra interna)
// e na marca.
//
// Com 1-2 letras essas regras só produzem ruído: o operador digitava "ar"
// atrás de ARROZ e recebia "Molho de tomate **ar**tesanal" e "Torrada
// **ar**tesanal" no meio da lista — produtos que nem começam com a letra que
// ele digitou. Duas letras casam com o começo de palavra de meio mundo.
//
// A partir de 3 o casamento volta a ser informativo: "cond" continua achando
// "Leite Condensado" e "tomate" continua achando "Molho de Tomate Quero",
// que são as buscas que justificam a regra existir.
//
// O prefixo do NOME INTEIRO não tem piso: digitar "a" e ver tudo que começa
// com A é previsível. Ref e EAN também não têm — são códigos, e prefixo curto
// de código é busca deliberada, não tentativa de adivinhar nome.
const MIN_CHARS_MIOLO = 3;

/**
 * O produto casa com o termo?
 *
 * `termoNorm` deve vir de normalizarBusca(); `termoRaw` é o texto cru, usado só
 * no EAN — que é numérico e não ganha nada em ser normalizado.
 *
 * O caso "alguma palavra começa com o termo" é intencional: sem ele, "cond"
 * deixaria de encontrar "Leite Condensado", que é busca legítima de operador.
 * Mas ele só entra a partir de MIN_CHARS_MIOLO — ver a nota acima.
 */
export function produtoCasa(p: ProdutoBuscavel, termoNorm: string, termoRaw: string): boolean {
  if (!termoNorm) return false;
  const nome = normalizarBusca(p.name);
  if (nome.startsWith(termoNorm)) return true;
  if (normalizarBusca(p.ref).startsWith(termoNorm)) return true;
  if (termoRaw && String(p.ean13 ?? '').startsWith(termoRaw)) return true;
  if (termoNorm.length < MIN_CHARS_MIOLO) return false;
  if (nome.split(PALAVRA_SPLIT).some(w => w.startsWith(termoNorm))) return true;
  if (normalizarBusca(p.marca).startsWith(termoNorm)) return true;
  return false;
}

/** 0 = nome começa com o termo, 1 = alguma palavra começa, 2 = casou por ref/marca/EAN. */
export function produtoRank(p: ProdutoBuscavel, termoNorm: string): number {
  const nome = normalizarBusca(p.name);
  if (nome.startsWith(termoNorm)) return 0;
  if (termoNorm.length >= MIN_CHARS_MIOLO
      && nome.split(PALAVRA_SPLIT).some(w => w.startsWith(termoNorm))) return 1;
  return 2;
}

/**
 * Filtra por prefixo e ordena: nome inteiro > palavra > ref/marca/EAN, depois A-Z.
 * Termo vazio devolve a lista original (só truncada), preservando a ordem que
 * a tela já tinha — busca vazia não deve reordenar a grade.
 */
export function buscarProdutos<T extends ProdutoBuscavel>(
  lista: T[],
  termoRaw: string,
  limite: number,
): T[] {
  const t = normalizarBusca(termoRaw.trim());
  if (!t) return lista.slice(0, limite);
  const raw = termoRaw.trim();
  return lista
    .filter(p => produtoCasa(p, t, raw))
    .sort((a, b) => {
      const ra = produtoRank(a, t);
      const rb = produtoRank(b, t);
      if (ra !== rb) return ra - rb;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'pt-BR');
    })
    .slice(0, limite);
}

/**
 * Gramática do multiplicador do PDV: `N*termo`, `N×termo`, `NxTermo` — com
 * decimal por vírgula para item de balança (`0,350*7891`).
 *
 * Mora aqui, e não dentro de uma tela, porque as formas de identificar o item
 * (campo CÓDIGO e busca do nicho) têm de aceitar a mesma coisa. `termo` volta
 * vazio em "2*" sozinho — que não é erro: é o operador ARMANDO a quantidade
 * antes de escolher o item, como se faz no caixa de mercado.
 */
export interface QtdETermo {
  qtd: number;
  termo: string;
  temMultiplicador: boolean;
}

// Literal (e não `new RegExp('...\s...')`): dentro de uma string simples o
// `\s` vira um "s" literal, e o padrão passaria a exigir a LETRA s em vez de
// espaço — "2 * 7891" (leitor que emite espaço) não casaria.
const MULTIPLICADOR = /^([0-9.,]+)\s*[*xX×]\s*(.*)$/;

export function separarQtdETermo(raw: string | null | undefined): QtdETermo {
  const t = String(raw ?? '').trim();
  const m = t.match(MULTIPLICADOR);
  if (!m) return { qtd: 1, termo: t, temMultiplicador: false };
  const n = parseFloat(m[1].replace(',', '.'));
  if (!(n > 0)) return { qtd: 1, termo: t, temMultiplicador: false };
  return { qtd: n, termo: m[2].trim(), temMultiplicador: true };
}
