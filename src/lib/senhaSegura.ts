// Recusa senha curta demais ou que já apareceu em vazamento conhecido.
//
// O Supabase tem isso pronto (Authentication > Providers > Email, "Prevent
// use of leaked passwords"), mas só no plano Pro — e este projeto está no
// gratuito. Como o único ponto em que alguém DIGITA uma senha aqui é o
// cadastro de operador pelo app (`Storage.createUser`), a checagem cabe no
// cliente. O script `provisionar-operadores.mjs` não passa por aqui e nem
// precisa: ele sorteia 14 caracteres com `randomBytes`, e senha sorteada
// não está em lista de vazamento.
//
// A consulta usa k-anonimato, o protocolo da própria API do HaveIBeenPwned:
// manda-se os 5 PRIMEIROS caracteres do SHA-1 da senha e recebe-se de volta
// as ~800 senhas cujo hash começa igual. A comparação do sufixo acontece
// aqui, no navegador. A senha — e o hash inteiro dela — nunca sai da máquina.
//
// Falha ABERTA de propósito: se a API não responder, o cadastro segue. Uma
// sala de aula com wi-fi instável não pode ficar sem cadastrar operador
// porque um serviço de terceiro caiu. O comprimento mínimo, esse sim, é
// verificado localmente e nunca deixa de valer.

export const MIN_SENHA = 8;

const API_HIBP = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 5000;

export type CodigoSenha = 'SENHA_CURTA' | 'SENHA_VAZADA';

export interface ErroSenha extends Error {
  code: CodigoSenha;
  /** Quantas vezes a senha aparece nos vazamentos. Só em SENHA_VAZADA. */
  ocorrencias?: number;
}

function erroSenha(code: CodigoSenha, message: string, ocorrencias?: number): ErroSenha {
  const e = new Error(message) as ErroSenha;
  e.code = code;
  if (ocorrencias !== undefined) e.ocorrencias = ocorrencias;
  return e;
}

/** SHA-1 em maiúsculas. `crypto.subtle` só existe em contexto seguro
 *  (https ou localhost) — fora disso devolve null e a checagem é pulada. */
async function sha1Hex(texto: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(texto);
  const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Quantas vezes a senha aparece em vazamentos conhecidos.
 * Devolve 0 se não aparece, e null se não deu para consultar.
 */
export async function contarVazamentos(senha: string): Promise<number | null> {
  const hash = await sha1Hex(senha);
  if (!hash) return null;

  const prefixo = hash.slice(0, 5);
  const sufixo = hash.slice(5);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resposta: Response;
    try {
      resposta = await fetch(`${API_HIBP}${prefixo}`, {
        signal: ctrl.signal,
        // Enche a resposta com registros falsos, para o tamanho dela não
        // insinuar nada a quem estiver observando a rede.
        headers: { 'Add-Padding': 'true' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resposta.ok) return null;

    const corpo = await resposta.text();
    for (const linha of corpo.split('\n')) {
      const [suf, qtd] = linha.trim().split(':');
      if (suf === sufixo) {
        const n = Number(qtd);
        // O padding vem com contagem 0: é registro falso, não é acerto.
        return Number.isFinite(n) && n > 0 ? n : 0;
      }
    }
    return 0;
  } catch {
    // Rede fora, DNS bloqueado, timeout: não temos resposta, não inventamos.
    return null;
  }
}

/**
 * Barra a senha se for curta ou vazada. Não devolve nada quando aprova;
 * lança `ErroSenha` quando recusa, para o chamador só precisar do try/catch.
 */
export async function exigirSenhaSegura(senha: string): Promise<void> {
  if (senha.length < MIN_SENHA) {
    throw erroSenha(
      'SENHA_CURTA',
      `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`,
    );
  }

  const ocorrencias = await contarVazamentos(senha);
  if (ocorrencias === null) return; // não deu para consultar: passa
  if (ocorrencias > 0) {
    throw erroSenha(
      'SENHA_VAZADA',
      'Esta senha já apareceu em vazamentos públicos e não pode ser usada.',
      ocorrencias,
    );
  }
}
