/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { ExternalLink, ShoppingBag, Share2, Globe, Check } from 'lucide-react';

interface CatalogSettings {
  catalogUrl: string;
  welcomeMessage: string;
}

export default function CatalogoModule() {
  const [catalogUrl, setCatalogUrl] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('catalog_settings');
    if (raw) {
      try {
        const data = JSON.parse(raw) as Partial<CatalogSettings>;
        setCatalogUrl(data.catalogUrl ?? '');
        setWelcomeMessage(data.welcomeMessage ?? '');
      } catch { /* ignore */ }
    }
  }, []);

  const normalizedUrl = (() => {
    const u = catalogUrl.trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    return `https://${u}`;
  })();

  const isValidUrl = (() => {
    if (!normalizedUrl) return false;
    try { new URL(normalizedUrl); return true; } catch { return false; }
  })();

  const handleOpen = () => {
    if (!isValidUrl) {
      alert('Cole um link válido (ex.: https://www.canva.com/...)');
      return;
    }
    window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShare = async () => {
    if (!isValidUrl) {
      alert('Salve um link antes de compartilhar.');
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Catálogo MaxPOS', url: normalizedUrl });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(normalizedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSave = () => {
    const settings: CatalogSettings = { catalogUrl: catalogUrl.trim(), welcomeMessage };
    localStorage.setItem('catalog_settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-full">
      {/* Card principal — URL do catálogo */}
      <section className="smart-card">
        <div className="flex items-center gap-4 mb-5 pb-4 border-b border-gray-200">
          <div className="w-14 h-14 rounded-lg flex items-center justify-center" style={{ background: '#172554' }}>
            <Globe size={28} className="text-white" />
          </div>
          <div>
            <h2 className="section-header" style={{ marginBottom: 0 }}>Link do Catálogo</h2>
            <p className="text-sm text-gray-600 mt-0.5">Cole o link da sua vitrine — pode ser um catálogo do Canva, um site, PDF público, etc.</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="smart-stat-label">URL do catálogo</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={catalogUrl}
              onChange={e => setCatalogUrl(e.target.value)}
              placeholder="https://www.canva.com/design/..."
              className="smart-input flex-1 font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={handleShare}
              disabled={!isValidUrl}
              className="smart-btn-secondary disabled:opacity-40"
              title={copied ? 'Link copiado!' : 'Compartilhar'}
            >
              {copied ? <Check size={18} className="text-emerald-600" /> : <Share2 size={18} />}
            </button>
            <button
              onClick={handleOpen}
              disabled={!isValidUrl}
              className="smart-btn-primary disabled:opacity-40"
            >
              <ExternalLink size={18} /> ABRIR
            </button>
          </div>
          {catalogUrl && !isValidUrl && (
            <p className="text-sm text-red-600 font-bold">URL inválida — confira o link e tente de novo.</p>
          )}
        </div>
      </section>

      {/* Dois cards lado a lado: pedidos + configurações */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pedidos */}
        <section className="smart-card">
          <h2 className="section-header mb-4 pb-3 border-b border-gray-200">
            <ShoppingBag size={22} className="text-emerald-700" /> Pedidos Online
          </h2>
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <ShoppingBag size={56} className="mb-3" />
            <p className="text-base font-bold">Nenhum pedido online</p>
            <p className="text-sm mt-1">Pedidos vindos do seu catálogo aparecerão aqui</p>
          </div>
        </section>

        {/* Configurações */}
        <section className="smart-card">
          <h2 className="section-header mb-4 pb-3 border-b border-gray-200">
            <Globe size={22} style={{ color: '#172554' }} /> Configurações da Vitrine
          </h2>

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="smart-stat-label">Mensagem de Boas-vindas</label>
              <textarea
                value={welcomeMessage}
                onChange={e => setWelcomeMessage(e.target.value)}
                placeholder="Ex.: Bem-vindo à nossa loja! Escolha seus produtos e finalize pelo WhatsApp."
                className="smart-input h-28 resize-none"
              />
            </div>

            <button
              onClick={handleSave}
              className="smart-btn-primary w-full"
            >
              {saved ? <><Check size={18} /> SALVO</> : 'SALVAR ALTERAÇÕES'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
