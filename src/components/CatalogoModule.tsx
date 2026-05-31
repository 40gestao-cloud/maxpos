/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { ExternalLink, ShoppingBag, Share2, Globe } from 'lucide-react';

const CATALOG_URL = 'maxpos.com/loja/meunegocio';

export default function CatalogoModule() {
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [showCostPrice, setShowCostPrice] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('catalog_settings');
    if (saved) {
      const { welcomeMessage: msg, showCostPrice: scp } = JSON.parse(saved);
      setWelcomeMessage(msg ?? '');
      setShowCostPrice(scp ?? false);
    }
  }, []);

  const handleShare = async () => {
    const url = `https://${CATALOG_URL}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Catálogo MaxPOS', url });
      } catch {
        // user cancelled
      }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSave = () => {
    localStorage.setItem('catalog_settings', JSON.stringify({ welcomeMessage, showCostPrice }));
    alert('Configurações da vitrine salvas com sucesso!');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="neumorphic p-10 text-center space-y-6">
        <div className="w-24 h-24 neumorphic-inset mx-auto flex items-center justify-center text-[#FFC107]">
          <Globe size={48} />
        </div>
        <div>
          <h2 className="text-3xl font-black text-main-text">Sua Loja está Online</h2>
          <p className="text-muted-text font-bold uppercase tracking-widest text-xs mt-2">Link público do seu catálogo digital</p>
        </div>

        <div className="max-w-md mx-auto neumorphic-inset p-4 flex items-center justify-between gap-4">
          <span className="text-sm font-mono text-[#FFC107] truncate">{CATALOG_URL}</span>
          <div className="flex gap-2">
            <button
              onClick={handleShare}
              className="p-2 hover:bg-white/5 rounded-lg text-muted-text hover:text-[#FFC107] transition-colors"
              title={copied ? 'Link copiado!' : 'Compartilhar'}
            >
              <Share2 size={18} className={copied ? 'text-emerald-500' : ''} />
            </button>
            <button
              onClick={() => window.open(`https://${CATALOG_URL}`, '_blank')}
              className="bg-[#FFC107] text-black font-black px-4 py-2 rounded-lg text-xs flex items-center gap-2 active:scale-95 transition-transform"
            >
              <ExternalLink size={14} /> ABRIR
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="neumorphic p-8">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-main-text">
            <ShoppingBag className="text-emerald-500" /> Pedidos Online Novos
          </h3>
          <div className="space-y-4">
            <div className="text-center py-20 opacity-30">
              <ShoppingBag size={48} className="mx-auto mb-2" />
              <p className="text-xs font-black uppercase tracking-widest">Nenhum pedido online</p>
            </div>
          </div>
        </div>

        <div className="neumorphic p-8">
          <h3 className="text-lg font-bold mb-6 text-main-text">Configurações da vitrine</h3>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Mensagem de Boas-vindas</label>
              <textarea
                value={welcomeMessage}
                onChange={e => setWelcomeMessage(e.target.value)}
                className="w-full neumorphic-inset p-4 bg-transparent border-none outline-none text-main-text text-sm h-24 resize-none"
                placeholder="Ex: Bem-vindo à nossa loja! Escolha seus produtos e finalize pelo WhatsApp."
              />
            </div>
            <button
              onClick={() => setShowCostPrice(v => !v)}
              className="w-full flex items-center justify-between p-4 neumorphic-inset hover:bg-white/2 transition-colors"
            >
              <span className="text-sm font-bold text-muted-text">Exibir Preço de Custo</span>
              <div className={`w-12 h-6 rounded-full transition-colors relative ${showCostPrice ? 'bg-[#FFC107]' : 'bg-white/10'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${showCostPrice ? 'left-7' : 'left-1'}`} />
              </div>
            </button>
            <button
              onClick={handleSave}
              className="w-full bg-[#FFC107] text-black py-4 rounded-xl font-black neumorphic hover:opacity-90 transition-opacity active:scale-95 uppercase text-xs tracking-widest"
            >
              SALVAR ALTERAÇÕES
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
