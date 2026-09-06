// Tradutor de erro do banco para português de operador.
//
// Todo módulo fazia `showAlert('Erro ao salvar: ' + err.message)`, e o que
// chegava na tela era o texto cru do Postgres:
//
//   duplicate key value violates unique constraint "products_ean13_pdv_mode_key"
//   new row violates row-level security policy for table "products"
//   JWT expired
//   Failed to fetch
//
// Nenhuma dessas frases diz ao aluno o que ele deve FAZER, e as três primeiras
// ainda expõem nome de constraint e de tabela. Aqui cada falha conhecida vira
// uma frase com o próximo passo; o que não for reconhecido mantém o texto
// original, porque errar a tradução seria pior que mostrar o original.
//
// Exceção importante: as nossas RPCs (finalize_sale_atomic, debitar_maxbank_
// salario e afins) levantam RAISE EXCEPTION já escrito em português para o
// operador — "Saldo de salario insuficiente. Disponivel: R$ 40,00". Esse texto
// passa intacto: foi escrito para ser lido.

export type VarianteErro = 'error' | 'warning';

export interface ErroExplicado {
  title: string;
  message: string;
  variant: VarianteErro;
}

interface ErroBruto {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
}

const bruto = (err: unknown): ErroBruto => {
  if (typeof err === 'string') return { message: err };
  if (err && typeof err === 'object') return err as ErroBruto;
  return { message: String(err ?? '') };
};

// O QUE duplicou, a partir do nome do índice que aparece na mensagem.
//
// O caminho óbvio seria ler `error.details` ("Key (ean13, pdv_mode)=(...)
// already exists."), mas o PostgREST devolve `details: null` — conferido
// contra o banco real. O que sobra na mensagem é o nome do índice, e ele
// basta: os índices deste projeto são nomeados pelo campo.
const INDICE_DUPLICADO: Record<string, string> = {
  products_ean13_pdv_mode_unq: 'Já existe outro produto nesta empresa com esse código de barras. Troque o EAN-13 ou use o botão Gerar.',
  products_ref_pdv_mode_unq: 'Já existe outro produto nesta empresa com essa referência (REF). Escolha outro código curto.',
  categories_nome_modo_uniq: 'Já existe uma categoria com esse nome nesta empresa.',
  maxbank_contas_colaborador_id_key: 'Este colaborador já tem conta no MaxBank.',
  uq_folha_pagamento_colaborador_mes: 'Este colaborador já tem folha lançada neste mês de referência.',
  cash_sessions_um_aberto_por_loja: 'Já existe um caixa aberto para este operador nesta empresa. Feche o caixa anterior antes de abrir outro.',
  user_profiles_um_admin_master: 'Só pode existir um Admin Master. Transfira o posto em vez de criar outro.',
};

function motivoDuplicidade(message: string): string | null {
  const m = /unique constraint "([^"]+)"/.exec(message);
  if (!m) return null;
  return INDICE_DUPLICADO[m[1]] ?? null;
}

/**
 * Transforma qualquer erro em título + mensagem prontos para `showAlert`.
 *
 * @param acao  o que estava sendo feito, em infinitivo e com artigo:
 *              'salvar o produto', 'excluir a categoria', 'carregar a folha'.
 *              Vira o título: "Não foi possível salvar o produto".
 */
export function explicarErro(err: unknown, acao: string): ErroExplicado {
  const e = bruto(err);
  const msg = String(e.message ?? '').trim();
  const codigo = String(e.code ?? '');
  const baixo = msg.toLowerCase();
  const titulo = `Não foi possível ${acao}`;

  // 1. Mensagem escrita pela nossa própria RPC: já está em português e já diz
  //    o que fazer. P0001 = RAISE EXCEPTION de PL/pgSQL.
  if (codigo === 'P0001' && msg) {
    return { title: titulo, message: msg, variant: 'warning' };
  }

  // 2. Rede — o mais comum na sala de aula (wi-fi da escola caindo).
  if (
    baixo.includes('failed to fetch') ||
    baixo.includes('networkerror') ||
    baixo.includes('load failed') ||
    baixo.includes('fetch failed')
  ) {
    return {
      title: 'Sem conexão com o servidor',
      message:
        'O navegador não conseguiu falar com o banco. Verifique a internet e tente de novo — o que você digitou continua na tela.',
      variant: 'warning',
    };
  }

  // 3. Sessão expirada. Sem isto o aluno via "JWT expired" e travava.
  if (
    baixo.includes('jwt expired') ||
    baixo.includes('invalid refresh token') ||
    baixo.includes('refresh_token_not_found') ||
    e.status === 401
  ) {
    return {
      title: 'Sua sessão expirou',
      message: 'Saia e entre de novo para continuar. Nada do que já foi salvo se perdeu.',
      variant: 'warning',
    };
  }

  // 4. RLS — o cargo não alcança a operação. Citar a tabela não ajuda ninguém.
  if (codigo === '42501' || baixo.includes('row-level security') || baixo.includes('violates row-level')) {
    return {
      title: 'Seu cargo não permite esta ação',
      message:
        'O sistema barrou a operação para o seu nível de acesso. Se você precisa fazer isso, peça ao Admin Master.',
      variant: 'warning',
    };
  }

  // 5. Duplicidade — diz QUAL campo repetiu.
  if (codigo === '23505' || baixo.includes('duplicate key')) {
    return {
      title: 'Esse registro já existe',
      message: motivoDuplicidade(msg)
        ?? 'Já existe um cadastro nesta empresa com esses mesmos dados. Confira os campos de identificação e salve de novo.',
      variant: 'warning',
    };
  }

  // 6. Chave estrangeira — o registro está em uso, ou aponta para algo que
  //    não existe mais.
  if (codigo === '23503' || baixo.includes('foreign key')) {
    return {
      title: 'Registro em uso',
      message:
        'Este item está ligado a outros registros (vendas, lançamentos ou itens do cadastro) e por isso não pode ser removido ou alterado assim. Desfaça esses vínculos antes.',
      variant: 'warning',
    };
  }

  // 7. Check / not-null / tipo inválido: campo obrigatório ou fora do formato.
  if (codigo === '23514' || codigo === '23502' || codigo === '22P02') {
    return {
      title: 'Dados inválidos',
      message:
        'Um dos campos ficou vazio ou fora do formato que o sistema aceita. Confira os campos obrigatórios e tente de novo.',
      variant: 'warning',
    };
  }

  // 8. Desconhecido: mantém o texto original, identificado como tal. Traduzir
  //    no chute esconderia justamente o caso que ninguém previu.
  return {
    title: titulo,
    message: msg
      ? `O banco recusou a operação com esta mensagem:\n\n${msg}`
      : 'O banco recusou a operação e não informou o motivo. Tente de novo; se repetir, avise o Admin Master.',
    variant: 'error',
  };
}
