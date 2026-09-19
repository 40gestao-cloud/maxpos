import { supabase } from './supabase';

/**
 * Assinatura de Realtime para as telas de gestão (Cadastros, Estoque,
 * Financeiro). Existe porque as três faziam a mesma coisa errada do mesmo
 * jeito: `event: '*'` sem filtro, e cada evento recarregando a tela inteira.
 *
 * Uma venda de 3 itens gera, em sequência, 1 INSERT em `sales` e 3 UPDATEs em
 * `products` (a baixa de estoque de `finalize_sale_atomic`), mais 1 UPDATE em
 * `clients` se tiver fiado. Eram 4-5 recargas completas por tela aberta — no
 * Cadastros, cada uma trazendo as fotos em base64 — e vindas também das
 * vendas das OUTRAS empresas, porque nada filtrava `pdv_mode`.
 *
 * Aqui:
 *  - `filtro` corta no servidor os eventos de outra empresa;
 *  - os eventos de uma rajada viram UM lote, entregue `esperaMs` depois do
 *    primeiro (latência limitada: não fica adiando enquanto chegar evento);
 *  - o lote diz QUAIS ids mudaram, e cada tela decide se recarrega a tabela ou
 *    só aquelas linhas.
 *
 * DELETE nunca é filtrado: o Realtime não aplica filtro em DELETE (com replica
 * identity padrão a linha antiga só traz a chave primária, não há `pdv_mode`
 * para comparar), então um DELETE filtrado simplesmente nunca chegaria. Por
 * isso ele é assinado sem filtro — chega o de todas as empresas, mas é só um
 * id, e a tela apenas o tira da lista se o tiver.
 */

export interface Mudancas {
  /** Inseridos ou alterados — a tela precisa buscar o estado atual deles. */
  alterados: Set<string>;
  /** Excluídos — basta tirar da lista, não há o que buscar. */
  removidos: Set<string>;
}

type Evento = 'INSERT' | 'UPDATE' | 'DELETE';

export interface Assinatura {
  tabela: string;
  /** Filtro do Realtime, ex. `pdv_mode=eq.supermax`. Vale para INSERT/UPDATE. */
  filtro?: string;
  eventos?: Evento[];
  /** Recebe o lote agrupado. Erro aqui vira aviso no console, não derruba nada. */
  aoMudar?: (m: Mudancas) => void | Promise<void>;
  /** Para quem precisa do payload cru, na hora, sem agrupar. */
  bruto?: (payload: any) => void;
}

export function assinarTabelas(
  canal: string,
  assinaturas: Assinatura[],
  esperaMs = 400,
): () => void {
  const pendentes = new Map<Assinatura, Mudancas>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let vivo = true;

  const descarregar = () => {
    timer = null;
    if (!vivo) return;
    const lote = [...pendentes];
    pendentes.clear();
    for (const [a, m] of lote) {
      // Alterado e depois excluído no mesmo lote: vale a exclusão.
      for (const id of m.removidos) m.alterados.delete(id);
      Promise.resolve(a.aoMudar!(m)).catch(err => {
        console.warn(`[realtime] falha ao atualizar ${a.tabela}`, err);
      });
    }
  };

  const anotar = (a: Assinatura, ev: Evento, id: unknown) => {
    if (id == null) return;
    const chave = String(id);
    let m = pendentes.get(a);
    if (!m) {
      m = { alterados: new Set(), removidos: new Set() };
      pendentes.set(a, m);
    }
    if (ev === 'DELETE') {
      m.removidos.add(chave);
    } else {
      m.alterados.add(chave);
      m.removidos.delete(chave);
    }
    if (!timer) timer = setTimeout(descarregar, esperaMs);
  };

  // Sufixo aleatório: a troca de aba desmonta e remonta a tela, e o
  // supabase-js devolve o canal EXISTENTE quando o nome se repete. Se o antigo
  // ainda estiver saindo, o `.on` cairia num canal já inscrito e lançaria erro.
  let ch = supabase.channel(`${canal}-${crypto.randomUUID().slice(0, 8)}`);
  for (const a of assinaturas) {
    for (const ev of a.eventos ?? (['INSERT', 'UPDATE', 'DELETE'] as Evento[])) {
      const cfg = {
        event: ev,
        schema: 'public',
        table: a.tabela,
        ...(a.filtro && ev !== 'DELETE' ? { filter: a.filtro } : {}),
      };
      ch = ch.on('postgres_changes' as any, cfg as any, (payload: any) => {
        if (!vivo) return;
        if (a.bruto) a.bruto(payload);
        if (a.aoMudar) anotar(a, ev, ev === 'DELETE' ? payload.old?.id : payload.new?.id);
      });
    }
  }
  ch.subscribe();

  return () => {
    vivo = false;
    if (timer) clearTimeout(timer);
    supabase.removeChannel(ch);
  };
}

/** Tira da lista os itens cujos ids foram excluídos. */
export const semRemovidos = <T extends { id: unknown }>(removidos: Set<string>) =>
  (prev: T[]): T[] => (removidos.size ? prev.filter(x => !removidos.has(String(x.id))) : prev);
