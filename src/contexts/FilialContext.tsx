/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
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
  /** Empresas que o usuario logado pode operar. */
  permitidas: PdvMode[];
  /** O App informa aqui as lojas do perfil recem-carregado. */
  setLojasDoUsuario: (lojas: string[] | undefined) => void;
}

const FilialContext = createContext<FilialContextValue>({
  filialAtiva: null,
  escolheu: false,
  setFilialAtiva: () => {},
  clearFilial: () => {},
  permitidas: VALIDAS,
  setLojasDoUsuario: () => {},
});

export function FilialProvider({ children }: { children: ReactNode }) {
  // Quem loga define quais empresas existem para ele. O App avisa via
  // `setLojasDoUsuario` assim que o perfil carrega — o provider fica ACIMA do
  // estado de usuario na arvore, entao a informacao sobe por aqui em vez de
  // descer por prop.
  const [lojasDoUsuario, setLojasDoUsuario] = useState<string[] | undefined>(undefined);
  // As empresas que ESTE usuario pode operar. Admin Master e CEO tem as tres;
  // Operador de Caixa tem exatamente uma, a de onde foi cadastrado. Sem a
  // lista (ainda no login) cai em VALIDAS, e nada muda.
  const permitidas: PdvMode[] = (lojasDoUsuario && lojasDoUsuario.length > 0)
    ? VALIDAS.filter(f => lojasDoUsuario.includes(f))
    : VALIDAS;

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

  // Operador de UMA empresa nao escolhe nada: entra direto na dele. Cadastrado
  // na SuperMax, loga e ja esta na SuperMax — o seletor so faz sentido para
  // quem tem para onde escolher (Admin Master e CEO).
  //
  // Tambem cobre a sessionStorage apontando para uma loja que o usuario nao
  // opera mais: terminal compartilhado onde o turno anterior deixou outra.
  useEffect(() => {
    if (permitidas.length === 0) return;
    if (permitidas.length === 1) {
      if (filialAtiva !== permitidas[0]) setFilialAtiva(permitidas[0]);
      return;
    }
    if (filialAtiva && !permitidas.includes(filialAtiva)) setState(null);
  }, [permitidas.join(','), filialAtiva]);

  const clearFilial = () => {
    if (permitidas.length <= 1) return; // nao ha para onde voltar
    setState(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* modo privado */ }
  };

  return (
    <FilialContext.Provider value={{
      filialAtiva,
      escolheu: filialAtiva !== null,
      setFilialAtiva,
      clearFilial,
      permitidas,
      setLojasDoUsuario,
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
