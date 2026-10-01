// Regra de senha do cadastro de operador pelo app (`Storage.createUser`).
//
// Só o comprimento mínimo — o mesmo do Supabase Auth e do LogMax. Até
// 2026-10-01 havia também uma consulta a senhas vazadas (HaveIBeenPwned), e
// ela foi retirada: em sala de aula a senha é combinada na hora e ditada ao
// aluno ("kevin123"), exatamente o tipo que consta em lista de vazamento. O
// cadastro era recusado várias vezes seguidas, e a consulta ainda segurava o
// botão por até 5 s sem resposta, o que rendia clique duplo e cadastro
// duplicado. As contas daqui não guardam dinheiro nem dado de terceiro; a
// trava custava mais do que protegia.

export const MIN_SENHA = 6;

export type CodigoSenha = 'SENHA_CURTA';

export interface ErroSenha extends Error {
  code: CodigoSenha;
}

/** Texto do motivo, ou null quando a senha serve. A tela usa para avisar
 *  no próprio campo, antes de enviar. */
export function motivoSenhaInvalida(senha: string): string | null {
  return senha.length < MIN_SENHA
    ? `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`
    : null;
}

/** Lança `ErroSenha` quando recusa, para o chamador só precisar do try/catch. */
export function exigirSenhaSegura(senha: string): void {
  const motivo = motivoSenhaInvalida(senha);
  if (!motivo) return;
  const e = new Error(motivo) as ErroSenha;
  e.code = 'SENHA_CURTA';
  throw e;
}
