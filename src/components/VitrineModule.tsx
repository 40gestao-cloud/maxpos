/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Star, ImageOff, Search, Package } from 'lucide-react';
import { Storage } from '../lib/storage';
import { Product } from '../types';
import { formatBRL } from '../lib/masks';
import { useAlertDialog } from './ConfirmDialog';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { buscarProdutos } from '../lib/produtoBusca';

// Curadoria do carrossel da tela de login.
//
// Só produtos COM FOTO entram: o carrossel é uma vitrine, e um card sem
// imagem não mostra nada — por isso os sem foto aparecem numa seção separada,
// explicando o que falta, em vez de simplesmente sumirem da lista.
//
// O teto de 12 vem da RPC, e não é enfeite: `image` é base64 de até 120 KB e
// isso trafega ANTES do login. A tela avisa quando o limite é atingido.
export const LIMITE_VITRINE = 12;

export default function VitrineModule() {
  const { showAlert, host: alertHost } = useAlertDialog();
  const { filialAtiva } = useFilial();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const carregar = () =>
    Storage.getProducts(filialAtiva ?? 'supermax')
      .then(setProducts)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filialAtiva]);

  const naVitrine = products.filter(p => p.vitrine);
  const comFoto = products.filter(p => !!p.image);
  const semFoto = products.filter(p => !p.image);
  const filtrados = buscarProdutos<Product>(comFoto, busca, comFoto.length);

  const alternar = async (p: Product) => {
    const entrando = !p.vitrine;
    // O limite é do carrossel inteiro (as três empresas somadas na RPC), mas
    // aqui só conseguimos contar a empresa atual. Avisamos pelo que dá pra
    // ver; a RPC corta em 12 de qualquer forma.
    if (entrando && naVitrine.length >= LIMITE_VITRINE) {
      showAlert(
        `A vitrine já tem ${LIMITE_VITRINE} produtos nesta empresa. ` +
        'Tire um antes de add outro — o carrossel carrega as fotos antes do login, ' +
        'e uma vitrine grande deixa a tela de entrada lenta.'
      );
      return;
    }
    setSalvando(p.id);
    try {
      await Storage.setVitrine(p.id, entrando);
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, vitrine: entrando } : x));
    } catch (err: any) {
      showAlert('Erro ao atualizar a vitrine: ' + (err?.message ?? err));
    } finally {
      setSalvando(null);
    }
  };

  const meta = FILIAL_META[filialAtiva ?? 'supermax'];

  return (
    <div className="space-y-6 max-w-full">
      {alertHost}

      <div className="neumorphic neumorphic-accent p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <Star size={18} style={{ color: meta.color }} /> Vitrine
          </h2>
          <p className="text-xs text-gray-600 font-bold uppercase tracking-widest mt-0.5">
            {naVitrine.length} de {LIMITE_VITRINE} — aparecem no carrossel da tela de login
          </p>
        </div>
        <div className="flex-1 md:flex-none md:w-72 neumorphic-inset flex items-center px-4 py-2 gap-3">
          <Search size={18} className="text-gray-600" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar produto..."
            className="bg-transparent border-none outline-none text-gray-900 text-sm w-full font-medium placeholder:text-gray-400"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4" aria-busy="true">
          <span className="sr-only">Carregando produtos…</span>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="neumorphic p-3 flex flex-col gap-2">
              <span className="skeleton w-full" style={{ aspectRatio: '1 / 1' }} aria-hidden="true">&nbsp;</span>
              <span className="skeleton" style={{ height: '0.8rem', width: '80%' }} aria-hidden="true">&nbsp;</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
            {filtrados.map(p => {
              const ativo = !!p.vitrine;
              return (
                <button
                  key={p.id}
                  onClick={() => alternar(p)}
                  disabled={salvando === p.id}
                  title={ativo ? 'Remover da vitrine' : 'Adicionar à vitrine'}
                  className="neumorphic neumorphic-clickable p-3 flex flex-col gap-2 text-left relative disabled:opacity-50"
                  style={ativo ? { borderColor: meta.color, borderWidth: 2 } : undefined}
                >
                  <span
                    className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center border-2"
                    style={ativo
                      ? { background: meta.color, color: meta.fg, borderColor: meta.dark }
                      : { background: 'rgba(255,255,255,0.9)', color: '#9ca3af', borderColor: 'rgba(0,0,0,0.15)' }}
                  >
                    <Star size={14} fill={ativo ? 'currentColor' : 'none'} />
                  </span>
                  <div className="w-full rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center" style={{ aspectRatio: '1 / 1' }}>
                    <img src={p.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <span className="text-xs font-bold text-gray-900 leading-tight line-clamp-2">{p.name}</span>
                  <span className="text-sm font-black tabular-nums" style={{ color: meta.dark }}>
                    {formatBRL(p.price)}
                  </span>
                </button>
              );
            })}
          </div>

          {filtrados.length === 0 && (
            <div className="neumorphic p-12 flex flex-col items-center gap-3 text-center">
              <Package size={36} className="text-gray-300" strokeWidth={1.5} />
              <p className="text-sm font-bold text-gray-700">
                {busca ? 'Nenhum produto encontrado' : 'Nenhum produto com foto nesta empresa'}
              </p>
              <p className="text-xs text-gray-500 max-w-sm">
                A vitrine mostra a foto do produto — sem foto não há o que exibir.
                Adicione imagens em <b>Cadastros › Produtos</b>.
              </p>
            </div>
          )}

          {/* Sem foto entra numa seção própria em vez de sumir: o operador
              precisa saber POR QUE o produto não está disponível pra vitrine. */}
          {semFoto.length > 0 && !busca && (
            <div className="neumorphic p-5">
              <h3 className="text-sm font-black text-gray-700 uppercase tracking-wide flex items-center gap-2">
                <ImageOff size={16} className="text-gray-400" />
                {semFoto.length} produto{semFoto.length === 1 ? '' : 's'} sem foto
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Não podem entrar na vitrine até receberem uma imagem em Cadastros › Produtos.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {semFoto.slice(0, 20).map(p => (
                  <span key={p.id} className="px-2 py-1 rounded text-[11px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                    {p.name}
                  </span>
                ))}
                {semFoto.length > 20 && (
                  <span className="px-2 py-1 text-[11px] font-bold text-gray-500">
                    +{semFoto.length - 20}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
