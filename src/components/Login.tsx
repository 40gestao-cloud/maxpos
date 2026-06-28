/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { User, LogIn, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Storage } from '../lib/storage';

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

  return (
    <div className="min-h-screen bg-main flex items-center justify-center p-6">
      <div className="w-full max-w-md neumorphic p-10 space-y-8">
        <div className="text-center">
          <div className="w-40 h-40 mx-auto flex items-center justify-center mb-4 overflow-hidden">
            <img src="/icon-maxpos.png" alt="MaxPOS" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">E-mail</label>
            <div className="neumorphic-inset flex items-center p-4 gap-3">
              <User size={20} className="text-gray-600" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplo@gmail.com"
                className="bg-transparent border-none outline-none text-gray-900 w-full font-bold placeholder:text-gray-400"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Senha</label>
            <div className="neumorphic-inset flex items-center p-4 gap-3">
              <LogIn size={20} className="text-gray-600" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-transparent border-none outline-none text-gray-900 w-full font-bold placeholder:text-gray-400"
                required
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-gray-600 hover:text-[#FFC107] transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <p className="text-red-500 text-xs font-bold text-center mt-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FFC107] text-black font-black py-4 rounded-xl hover:bg-[#ffca2c] transition-all transform active:scale-95 shadow-[0_0_30px_rgba(255,193,7,0.2)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
          <img src="/icon-assinatura-modoclaro.png" alt="Assinatura" className="mx-auto h-8" />
        </div>
      </div>
    </div>
  );
}
