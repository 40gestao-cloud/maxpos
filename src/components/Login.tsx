/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { Storage } from '../lib/storage';
import { VitrineCarousel } from './VitrineCarousel';

interface LoginProps {
  onLogin: (user: any) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await Storage.login(email.trim().toLowerCase(), password);
      if (user) {
        onLogin(user);
      } else {
        setError('Credenciais inválidas. Verifique seu e-mail e senha.');
      }
    } catch {
      setError('Erro ao conectar. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Campo no desenho dos formulários do sistema: branco, borda de 2px e halo
  // amarelo no foco. Em repouso a borda é cinza — amarelo direto, como nos
  // modais escuros, some no card branco.
  const campo = 'group flex items-center gap-3 px-4 h-14 bg-white rounded-xl border-2 border-gray-200 transition-all hover:border-gray-300 focus-within:border-[var(--accent)] focus-within:hover:border-[var(--accent)] focus-within:shadow-[0_0_0_4px_rgba(255,193,7,0.3)]';
  const icone = 'shrink-0 text-gray-400 transition-colors group-focus-within:text-[#021D55]';
  const rotulo = 'block text-xs font-black text-[#021D55] uppercase tracking-widest ml-1';
  const entrada = 'bg-transparent border-none outline-none text-gray-900 w-full h-full font-semibold placeholder:text-gray-400 placeholder:font-normal';

  return (
    // Duas colunas no modelo do LogMax: vitrine à esquerda (só desktop) e
    // login à direita, agrupados num container central — em tela widescreen
    // os dois ficavam colados nas bordas. No mobile a vitrine sai e o card de
    // login volta a ser o único conteúdo, centralizado.
    <div
      className="min-h-screen w-full flex items-center justify-center relative overflow-hidden"
      // Mesmo navy do fundo do icon-maxpos.png.
      style={{ background: '#021D55' }}
    >
      <div className="w-full max-w-6xl flex flex-col md:flex-row md:min-h-screen items-center">
        <div className="hidden md:flex md:flex-1 md:min-h-screen items-center justify-center">
          <VitrineCarousel />
        </div>

        <div className="flex-1 flex items-center justify-center p-6 md:p-10 w-full">
      <div className="w-full max-w-md bg-white rounded-2xl border-4 p-10 space-y-8" style={{ borderColor: '#FFC107' }}>
        <div className="text-center">
          <div className="w-40 h-40 mx-auto flex items-center justify-center mb-4 overflow-hidden rounded-2xl border-4" style={{ borderColor: '#FFC107' }}>
            <img src="/icon-maxpos.png" alt="MaxPOS" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="login-email" className={rotulo}>E-mail</label>
            <div className={campo}>
              <Mail size={20} className={icone} />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplo@gmail.com"
                className={entrada}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="login-senha" className={rotulo}>Senha</label>
            <div className={campo}>
              <Lock size={20} className={icone} />
              <input
                id="login-senha"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={entrada}
                required
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="text-gray-400 hover:text-[#021D55] transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <p className="text-red-500 text-xs font-bold text-center mt-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[var(--accent)] text-black font-black py-4 rounded-xl hover:bg-[#ffca2c] transition-all transform active:scale-95 shadow-[0_0_30px_rgba(255,193,7,0.2)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ENTRANDO...
              </span>
            ) : (
              'ENTRAR NO SISTEMA'
            )}
          </button>
        </form>

        <div className="pt-6 text-center">
          <img src="/icon-assinatura-modoclaro.png" alt="Assinatura" className="mx-auto h-12" />
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
