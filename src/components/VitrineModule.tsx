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
import { explicarErro } from '../lib/erros';
import { useFilial } from '../contexts/FilialContext';
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
  const [filtroVitrine, setFiltroVitrine] = useState<'todos' | 'dentro' | 'fora'>('todos');

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
        'Tire um antes de adicionar outro — o carrossel carrega as fotos antes do login, ' +
        'e uma vitrine grande deixa a tela de entrada lenta.'
      );
      return;
    }
    setSalvando(p.id);
    try {
      await Storage.setVitrine(p.id, entrando);
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, vitrine: entrando } : x));
    } catch (err: any) {
      showAlert(explicarErro(err, 'atualizar a vitrine'));
    } finally {
      setSalvando(null);
    }
  };

  const visiveis = filtroVitrine === 'dentro' ? filtrados.filter(p => p.vitrine)
    : filtroVitrine === 'fora' ? filtrados.filter(p => !p.vitrine)
    : filtrados;
  const cheia = naVitrine.length >= LIMITE_VITRINE;

  return (
    <div className="space-y-5 max-w-full">
      {alertHost}

      {/* Uma barra só: filtro à esquerda, lotação no meio, busca à direita —
          colada na grade que ela filtra. Havia um card de título (repetia o
          nome da aba) e uma faixa "Na vitrine agora" que mostrava o mesmo que
          o filtro "Na vitrine"; os escolhidos agora têm um lugar só. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200">
          {([
            ['todos', 'Todos', comFoto.length],
            ['dentro', 'Na vitrine', naVitrine.length],
            ['fora', 'Fora da vitrine', comFoto.length - naVitrine.length],
          ] as const).map(([id, rotulo, n]) => (
            <button
              key={id}
              onClick={() => setFiltroVitrine(id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                filtroVitrine === id ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow' : 'text-gray-700 hover:bg-white'
              }`}
            >
              {rotulo} <span className="opacity-70 tabular-nums">{n}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5" title="Quantos produtos desta empresa estão no carrossel da tela de login">
          <span className="text-sm text-gray-700 whitespace-nowrap">
            <b className="tabular-nums text-gray-900">{naVitrine.length} de {LIMITE_VITRINE}</b> no carrossel do login
          </span>
          <div className="h-2 w-28 rounded-full bg-gray-200 overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full transition-all" style={{ width: `${(naVitrine.length / LIMITE_VITRINE) * 100}%`, background: cheia ? '#dc2626' : 'var(--accent)' }} />
          </div>
        </div>

        <div className="ml-auto flex-1 sm:flex-none sm:w-72 neumorphic-inset flex items-center px-3 py-2 gap-2">
          <Search size={16} className="text-gray-600 shrink-0" />
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
            {visiveis.map(p => {
              const ativo = !!p.vitrine;
              return (
                <button
                  key={p.id}
                  onClick={() => alternar(p)}
                  disabled={salvando === p.id}
                  title={ativo ? 'Tirar da vitrine' : 'Pôr na vitrine'}
                  aria-pressed={ativo}
                  className="neumorphic neumorphic-clickable p-3 flex flex-col gap-2 text-left relative disabled:opacity-50"
                  // Destaque no amarelo da marca, igual para as três empresas.
                  // Era a cor da empresa a 10%: com a SuperMax em navy o card
                  // escolhido ficava cinza, com cara de desabilitado.
                  style={ativo
                    ? { borderColor: 'var(--accent)', borderWidth: 3, background: 'color-mix(in srgb, var(--accent) 14%, white)' }
                    : undefined}
                >
                  {ativo && (
                    <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full text-[11px] font-bold shadow bg-[var(--accent)] text-[var(--accent-fg)]">
                      Na vitrine
                    </span>
                  )}
                  <span
                    className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center border-2"
                    style={ativo
                      ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent-dark)' }
                      : { background: 'rgba(255,255,255,0.95)', color: '#6b7280', borderColor: 'rgba(0,0,0,0.2)' }}
                  >
                    <Star size={14} fill={ativo ? 'currentColor' : 'none'} />
                  </span>
                  {/* `contain` sobre branco, como no carrossel do login: o que
                      se vê aqui é o que vai aparecer lá. `cover` recortava a
                      embalagem. */}
                  <div className="w-full rounded-lg overflow-hidden bg-white flex items-center justify-center" style={{ aspectRatio: '1 / 1' }}>
                    <img src={p.image} alt="" className="w-full h-full object-contain" loading="lazy" />
                  </div>
                  <span className="text-sm font-semibold text-gray-900 leading-tight line-clamp-3" title={p.name}>{p.name}</span>
                  <span className="mt-auto text-sm font-black tabular-nums text-gray-900">
                    {formatBRL(p.price)}
                  </span>
                </button>
              );
            })}
          </div>

          {visiveis.length === 0 && (
            <div className="neumorphic p-12 flex flex-col items-center gap-3 text-center">
              <Package size={36} className="text-gray-400" strokeWidth={1.5} />
              <p className="text-sm font-bold text-gray-800">
                {busca ? 'Nenhum produto encontrado'
                  : filtroVitrine === 'dentro' ? 'Nenhum produto na vitrine ainda'
                  : 'Nenhum produto com foto nesta empresa'}
              </p>
              <p className="text-sm text-gray-600 max-w-sm">
                A vitrine mostra a foto do produto — sem foto não há o que exibir.
                Adicione imagens em <b>Cadastros › Produtos</b>.
              </p>
            </div>
          )}

          {/* Sem foto entra numa seção própria em vez de sumir: o operador
              precisa saber POR QUE o produto não está disponível pra vitrine. */}
          {semFoto.length > 0 && !busca && filtroVitrine !== 'dentro' && (
            <div className="neumorphic p-5">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <ImageOff size={16} className="text-gray-500" />
                {semFoto.length} produto{semFoto.length === 1 ? '' : 's'} sem foto
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Não podem entrar na vitrine até receberem uma imagem em Cadastros › Produtos.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {semFoto.slice(0, 20).map(p => (
                  <span key={p.id} className="px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                    {p.name}
                  </span>
                ))}
                {semFoto.length > 20 && (
                  <span className="px-2 py-1 text-xs font-semibold text-gray-600">
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
