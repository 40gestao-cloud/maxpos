/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, useState, type ReactNode } from 'react';
import { PdvMode } from '../types';

// As três lojas são empresas separadas: cada uma tem seus produtos, seu caixa,
// seu estoque e seu resultado. O operador entra em UMA e opera dentro dela até
// trocar — não existe modo consolidado, e por isso nenhuma tela precisa mais
// de filtro de loja: a loja é o contexto da sessão inteira.
//
// Dois estados:
//   escolheu=false → acabou de logar, App mostra o seletor.
//   escolheu=true  → operando dentro de `filialAtiva`.
//
// sessionStorage e não localStorage: a escolha vale para a sessão do
// navegador. Fechar e reabrir devolve o operador ao seletor, que é o certo
// num terminal compartilhado — o turno seguinte não herda a loja do anterior.
const STORAGE_KEY = 'maxpos:filialAtiva';

const VALIDAS: PdvMode[] = ['supermax', 'maxlook', 'techmax'];

interface FilialContextValue {
  filialAtiva: PdvMode | null;
  escolheu: boolean;
  setFilialAtiva: (f: PdvMode) => void;
  clearFilial: () => void;
}

const FilialContext = createContext<FilialContextValue>({
  filialAtiva: null,
  escolheu: false,
  setFilialAtiva: () => {},
  clearFilial: () => {},
});

export function FilialProvider({ children }: { children: ReactNode }) {
  const [filialAtiva, setState] = useState<PdvMode | null>(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY) as PdvMode | null;
      return v && VALIDAS.includes(v) ? v : null;
    } catch { return null; }
  });

  const setFilialAtiva = (f: PdvMode) => {
    setState(f);
    try { sessionStorage.setItem(STORAGE_KEY, f); } catch { /* modo privado */ }
  };

  const clearFilial = () => {
    setState(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* modo privado */ }
  };

  return (
    <FilialContext.Provider value={{
      filialAtiva,
      escolheu: filialAtiva !== null,
      setFilialAtiva,
      clearFilial,
    }}>
      {children}
    </FilialContext.Provider>
  );
}

export const useFilial = () => useContext(FilialContext);

// Identidade visual de cada loja, num lugar só. Estava duplicada entre
// CadastrosModule (NICHO_META), FiltroLoja (LOJAS) e o PDV (PDV_MODE_META).
export const FILIAL_META: Record<PdvMode, {
  label: string;
  descricao: string;
  logo: string;
  color: string;
  dark: string;
  fg: string;
  /** Cor da placa do logo — espelha o fundo que já vem embutido no PNG.
   *  supermax é arte transparente (fecha sobre claro), techmax vem com branco
   *  chapado e maxlook com preto. Enquanto os três não vierem transparentes,
   *  a placa não tem como ser a mesma cor nos três. */
  plate: string;
}> = {
  supermax: {
    label: 'SuperMax',
    descricao: 'Supermercado',
    logo: '/icon-supermax.png',
    color: '#3b82f6', dark: '#1d4ed8', fg: '#ffffff', plate: '#ffffff',
  },
  maxlook: {
    label: 'MaxLook',
    descricao: 'Boutique de moda',
    logo: '/icon-maxlook.png',
    color: '#c9a882', dark: '#8a5a3b', fg: '#3b1f0a', plate: '#000000',
  },
  techmax: {
    label: 'TechMax',
    descricao: 'Eletrônicos e assistência',
    logo: '/icon-techmax.png',
    color: '#f97316', dark: '#c2410c', fg: '#ffffff', plate: '#ffffff',
  },
};

export const FILIAIS: PdvMode[] = VALIDAS;
