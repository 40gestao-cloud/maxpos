/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Ficha de produto por nicho — SuperMax não tem (é supermercado padrão,
// o formulário base já cobre). MaxLook e TechMax têm particularidades que
// não cabem nas colunas fixas (nome/preço/estoque/EAN): tamanho e cor de
// roupa, modelo e garantia de eletrônico.
//
// Vocabulário e estrutura portados do cadastro de produto do LogMax
// (src/lib/atributosProduto.ts) — MaxPOS simula essas duas lojas, e o
// aprendiz que passar por aqui deve encontrar os mesmos campos lá. Só que
// o MaxPOS não tem fluxo de compras/recebimento: por isso ficou de fora
// tudo que dependia disso (per-unidade IMEI, peso de embalagem etc.) — aqui
// é só a ficha, sem automação por trás.
//
// Guardado em `products.atributos` (JSONB), vazio ({}) em SuperMax.

export type AtributoDef = {
  key: string;
  label: string;
  placeholder?: string;
  req?: boolean;
  type?: 'text' | 'select' | 'textarea';
  options?: readonly string[];
  wide?: boolean; // ocupa a linha inteira no grid
  /** Explica o campo quando o rótulo não basta. */
  dica?: string;
  /** Restringe a digitação a dígitos (ex.: garantia em dias). */
  soDigitos?: boolean;
  /** Valor com que o campo nasce num cadastro novo. Continua editável. */
  padrao?: string;
  /**
   * Só para type='select': além das opções, oferece "Outro" e abre um campo
   * de texto livre. A lista cobre o comum; travar o resto (tamanho de peça
   * importada, cor de coleção) obrigaria a digitar errado só pra caber numa
   * opção que não existe.
   */
  livre?: boolean;
};

export const ATRIBUTOS_PRODUTO: Record<string, AtributoDef[]> = {
  maxlook: [
    // Texto livre aqui é o que fabrica variante fantasma: "M", "Média" e
    // "Medio" viram três tamanhos diferentes pro sistema. Lista + "Outro"
    // para o que ela não cobre.
    { key: 'tamanho', label: 'Tamanho', type: 'select', req: true, livre: true,
      options: ['PP', 'P', 'M', 'G', 'GG', 'XG', 'Único',
                '36', '38', '40', '42', '44', '46', '48'] as const },
    { key: 'cor', label: 'Cor', type: 'select', req: true, livre: true,
      options: ['Preto', 'Branco', 'Cinza', 'Bege', 'Marrom', 'Azul', 'Azul Marinho',
                'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Roxo', 'Estampado'] as const },
    { key: 'genero', label: 'Gênero', type: 'select', req: true,
      options: ['Feminino', 'Masculino', 'Unissex', 'Infantil'] as const },
    { key: 'colecao', label: 'Coleção', placeholder: 'Ex.: Verão 2026' },
    { key: 'material', label: 'Composição / Material', placeholder: 'Ex.: 100% Algodão' },
  ],
  techmax: [
    { key: 'modelo', label: 'Modelo', placeholder: 'Ex.: iPhone 13, Galaxy S23', req: true },
    { key: 'estado', label: 'Estado', type: 'select', req: true,
      options: ['Novo', 'Seminovo', 'Vitrine', 'Recondicionado'] as const,
      dica: 'Vitrine é aparelho novo que ficou exposto. Recondicionado passou por reparo do fabricante.' },
    { key: 'cor', label: 'Cor', placeholder: 'Ex.: Meia-noite, Titânio' },
    { key: 'memoria', label: 'Memória', placeholder: 'Ex.: 128 GB, 256 GB' },
    // Texto livre virava "1 ano", "12 meses" e "90 dias" na mesma coluna —
    // três formatos que nada consegue somar numa data. Só dígitos.
    // Nasce com 90 (mínimo do CDC pra produto durável); quem dá mais, ajusta.
    { key: 'garantia_dias', label: 'Garantia (dias)', placeholder: 'Ex.: 90, 365',
      type: 'text', soDigitos: true, req: true, padrao: '90',
      dica: 'Em dias, a partir da venda. 90 é o mínimo legal do CDC — a garantia do fabricante costuma ser 365.' },
    { key: 'informacoes_adicionais', label: 'Informações adicionais', type: 'textarea', wide: true,
      placeholder: 'Ex.: acompanha carregador e capa; aparelho de vitrine com pequena marca na traseira.' },
  ],
};

/** Ficha inicial de um cadastro novo nesta empresa — só os campos com `padrao`. */
export const atributosPadrao = (pdvMode: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const d of ATRIBUTOS_PRODUTO[pdvMode] ?? []) {
    if (d.padrao !== undefined) out[d.key] = d.padrao;
  }
  return out;
};
