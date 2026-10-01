import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas. Crie um arquivo .env na raiz do projeto.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente só para o `signUp` do cadastro de operador. O signUp devolve a
// sessão da conta NOVA; no cliente principal isso trocava quem está logado
// pelo operador recém-criado, e o app tinha de restaurar o admin em seguida.
// Aqui a sessão fica em memória, num storage à parte, e é descartada — o
// admin nunca deixa de ser o admin.
export const supabaseCadastro = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'maxpos-cadastro',
  },
});
