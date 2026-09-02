#!/usr/bin/env node
/**
 * Provisiona operadores de caixa em massa — um login por CAIXA, por empresa.
 *
 * Por que existe: o caixa é único por (operador, empresa). Rodar 40 caixas
 * simultâneos na mesma loja exige 40 LOGINS distintos nela; dois terminais no
 * mesmo usuário fazem o segundo bater no índice
 * `cash_sessions_um_aberto_por_loja` e receber "duplicate key ... one open per
 * operator". Criar isso à mão no painel, vezes três empresas, é inviável.
 *
 * Uso (com a service_role no .env local, que e gitignorado):
 *   node --env-file=.env scripts/provisionar-operadores.mjs --loja=maxlook --de=1 --ate=40 --aplicar
 *
 *   --loja    supermax | maxlook | techmax        (obrigatório)
 *   --de/--ate  faixa numérica dos caixas          (padrão 1..40)
 *   --dominio  domínio dos e-mails                 (padrão caixa.local)
 *   --aplicar  sem esta flag o script só SIMULA e não escreve nada
 *
 * A senha de cada operador é gerada aleatória e impressa UMA vez, no final,
 * em CSV. Guarde essa saída — ela não fica salva em lugar nenhum.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const LOJAS_VALIDAS = ['supermax', 'maxlook', 'techmax'];

const arg = (nome, padrao) => {
  const hit = process.argv.find(a => a.startsWith(`--${nome}=`));
  return hit ? hit.split('=').slice(1).join('=') : padrao;
};
const temFlag = nome => process.argv.includes(`--${nome}`);

const loja    = arg('loja');
const de      = Number(arg('de', '1'));
const ate     = Number(arg('ate', '40'));
const dominio = arg('dominio', 'caixa.local');
const aplicar = temFlag('aplicar');

// A URL nao e segredo (ela ja vai no bundle), entao aproveitamos a que o app
// usa e evitamos duplicar a mesma informacao com dois nomes no .env.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// A service_role, sim, e segredo: ignora TODA a RLS. Nunca com prefixo VITE_
// (viraria publica no bundle) e nunca em variavel de ambiente da Vercel — o
// app e estatico, nao ha backend la que a use.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function morrer(msg) {
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

if (!url) morrer('defina SUPABASE_URL (ou VITE_SUPABASE_URL) no ambiente.');
if (!key) {
  morrer(
    [
      'defina SUPABASE_SERVICE_ROLE_KEY no ambiente.',
      '  Com a chave no .env local (gitignorado), rode:',
      '    node --env-file=.env scripts/provisionar-operadores.mjs --loja=... --aplicar',
    ].join('\n')
  );
}
if (!LOJAS_VALIDAS.includes(loja)) morrer(`--loja precisa ser uma de: ${LOJAS_VALIDAS.join(', ')}`);
if (!Number.isInteger(de) || !Number.isInteger(ate) || de < 1 || ate < de) {
  morrer('--de e --ate precisam ser inteiros com --de <= --ate.');
}
if (ate - de + 1 > 200) morrer('faixa maior que 200 operadores de uma vez; rode em lotes.');

// service_role ignora RLS por definição — é a chave de administração do
// projeto. Nunca deve entrar no bundle do app nem no repositório.
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// Senha forte e legível de digitar num teclado de PDV: sem caracteres que o
// operador confunde (0/O, 1/l/I).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const senhaAleatoria = (n = 14) =>
  Array.from(randomBytes(n)).map(b => ALFABETO[b % ALFABETO.length]).join('');

const pad = n => String(n).padStart(3, '0');

async function main() {
  const total = ate - de + 1;
  console.log(`\n  Loja .......... ${loja}`);
  console.log(`  Operadores .... caixa${pad(de)}..caixa${pad(ate)}@${loja}.${dominio} (${total})`);
  console.log(`  Modo .......... ${aplicar ? 'APLICAR (escreve no banco)' : 'SIMULAÇÃO (nada será criado)'}\n`);

  const criados = [];
  const pulados = [];
  const falhas  = [];

  for (let i = de; i <= ate; i++) {
    const email = `caixa${pad(i)}@${loja}.${dominio}`;
    const nome  = `Caixa ${pad(i)} — ${loja}`;

    if (!aplicar) {
      console.log(`  [simulado] ${email}`);
      continue;
    }

    const senha = senhaAleatoria();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true, // caixa de loja não tem inbox para confirmar
      // O trigger handle_new_user le daqui. Sem `loja`, o perfil nasce sem
      // empresa e o trigger aplica_lojas_por_cargo recusa o cadastro — o erro
      // chega como um generico "Database error creating new user".
      user_metadata: { name: nome, role: 'operador_caixa', loja },
    });

    if (error) {
      // Reexecutar o script não pode explodir: e-mail já existente é sucesso
      // silencioso, não erro. Assim dá para ampliar a faixa depois.
      if (/already been registered|already exists/i.test(error.message)) {
        pulados.push(email);
        console.log(`  [existe]   ${email}`);
        continue;
      }
      falhas.push({ email, erro: error.message });
      console.log(`  [FALHOU]   ${email} — ${error.message}`);
      continue;
    }

    // O perfil manda no acesso: `role` define o que ele pode, `lojas` define
    // ONDE. Operador de caixa fica preso à sua empresa — é o que a policy
    // `*_isolada_por_loja` lê via pode_loja().
    const { error: perfilErr } = await admin.from('user_profiles').upsert({
      id: data.user.id,
      email,
      name: nome,
      // 'operador_caixa' e o cargo de balcao (src/types.ts). Nao invente cargo
      // novo aqui: o CHECK `user_profiles_role_valido` so aceita
      // admin_master / ceo / operador_caixa, e qualquer outro valor faz o
      // upsert falhar com o auth.user JA criado — sobra um usuario sem perfil.
      role: 'operador_caixa',
      lojas: [loja],
    });

    if (perfilErr) {
      falhas.push({ email, erro: `perfil: ${perfilErr.message}` });
      console.log(`  [FALHOU]   ${email} — perfil: ${perfilErr.message}`);
      continue;
    }

    criados.push({ email, senha });
    console.log(`  [criado]   ${email}`);
  }

  if (!aplicar) {
    console.log(`\n  Simulação concluída. Repita com --aplicar para criar de verdade.\n`);
    return;
  }

  console.log(`\n  Criados: ${criados.length} · Já existiam: ${pulados.length} · Falhas: ${falhas.length}`);

  if (criados.length) {
    console.log(`\n  ─── SENHAS (aparecem UMA vez — copie agora) ───`);
    console.log(`email,senha,loja`);
    for (const c of criados) console.log(`${c.email},${c.senha},${loja}`);
    console.log('');
  }

  if (falhas.length) {
    console.log(`  Falhas:`);
    for (const f of falhas) console.log(`    ${f.email} — ${f.erro}`);
    process.exitCode = 1;
  }
}

main().catch(e => morrer(e?.message ?? String(e)));
