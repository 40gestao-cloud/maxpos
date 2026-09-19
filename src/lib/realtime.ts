import { useSyncExternalStore } from 'react';
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
 *
 * ─── O corte de conexão ───
 *
 * O phoenix (por baixo do supabase-js) já reconecta sozinho: `onError` e
 * `onClose` reagendam o rejoin com backoff enquanto o socket estiver de pé.
 * O que ele NÃO faz é contar para a aplicação que houve um buraco — e o que
 * passou durante o buraco não é reenviado. Numa sala com 50 terminais isso é
 * rotina, não exceção: basta a tampa do notebook fechar, o celular trocar de
 * Wi-Fi para 4G, ou o AP da sala engasgar.
 *
 * O resultado era a pior falha possível num PDV: a tela congelava com dado
 * velho, com cara de dado certo, e ninguém ficava sabendo — nem o operador,
 * nem o console.
 *
 * Por isso, aqui:
 *  - `aoRessincronizar` é chamado quando a assinatura VOLTA depois de um
 *    corte (e quando a aba ou a rede voltam), para a tela reler o que perdeu;
 *  - um vigia refaz o canal do zero se ele ficar fora do ar além da janela de
 *    retentativa. Existe por um caso terminal real: quando o servidor devolve
 *    bindings diferentes dos pedidos, o supabase-js chama `unsubscribe()` e o
 *    canal nunca mais tenta nada — sem o vigia, fica morto para sempre;
 *  - o estado agregado fica disponível em `useRealtimeDegradado`, para o App
 *    poder dizer na tela que os dados podem estar atrasados.
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

export interface OpcoesAssinatura {
  esperaMs?: number;
  /**
   * Releitura completa da tela. Chamado quando a assinatura volta de um corte,
   * quando a aba reaparece e quando a rede volta — nunca na primeira conexão,
   * porque aí quem carrega é a própria tela.
   */
  aoRessincronizar?: () => void | Promise<void>;
}

// ─── Estado agregado da conexão ──────────────────────────────
// Um registro por assinatura viva. O App lê o agregado para avisar na tela;
// nenhuma tela precisa saber da existência disso.

interface Registro { ligada: boolean }

const conexoes = new Set<Registro>();
const ouvintes = new Set<() => void>();
let degradado = false;

function recalcular() {
  const agora = [...conexoes].some(c => !c.ligada);
  if (agora === degradado) return;
  degradado = agora;
  for (const o of ouvintes) o();
}

/** `true` quando alguma assinatura está fora do ar — a tela pode estar velha. */
export function useRealtimeDegradado(): boolean {
  return useSyncExternalStore(
    (aoMudar) => { ouvintes.add(aoMudar); return () => { ouvintes.delete(aoMudar); }; },
    () => degradado,
    () => false,
  );
}

const TODOS_EVENTOS: Evento[] = ['INSERT', 'UPDATE', 'DELETE'];

/** Quanto o vigia espera antes de concluir que o canal não volta sozinho. */
const VIGIA_MS = 15_000;
/** Idem, mas quando a aba/rede acabou de voltar: aí a recuperação é urgente. */
const VIGIA_CURTO_MS = 3_000;

export function assinarTabelas(
  canal: string,
  assinaturas: Assinatura[],
  opts: OpcoesAssinatura | number = {},
): () => void {
  const { esperaMs = 400, aoRessincronizar } =
    typeof opts === 'number' ? { esperaMs: opts, aoRessincronizar: undefined } : opts;

  const pendentes = new Map<Assinatura, Mudancas>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let vivo = true;

  const conexao: Registro = { ligada: false };
  conexoes.add(conexao);
  recalcular();

  let ch: ReturnType<typeof supabase.channel> | null = null;
  // Só ressincroniza quem já esteve ligado: na primeira conexão não há buraco
  // nenhum para cobrir, e quem carrega a tela é a própria tela.
  let jaLigou = false;
  let vigia: ReturnType<typeof setTimeout> | null = null;
  let timerResync: ReturnType<typeof setTimeout> | null = null;
  let ultimoResync = 0;

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
    // O sorteio no fim não é folga: os 50 terminais recebem o MESMO evento no
    // mesmo instante, então um atraso fixo faz os 50 consultarem juntos. Espalhar
    // em meia janela não muda nada para quem olha a tela e tira o pico do banco.
    if (!timer) timer = setTimeout(descarregar, esperaMs + Math.random() * (esperaMs / 2));
  };

  const marcar = (ligada: boolean) => {
    if (conexao.ligada === ligada) return;
    conexao.ligada = ligada;
    recalcular();
  };

  /**
   * Relê a tela depois de um buraco. O atraso NÃO é folga: uma queda de rede
   * derruba os 50 terminais ao mesmo tempo, e sem o sorteio todos voltariam
   * disparando a mesma consulta no mesmo instante — trocaríamos uma tela
   * velha por um pico de carga no banco. Chamadas seguidas (aba voltou E
   * canal reconectou) viram uma só.
   */
  const ressincronizar = (motivo: string) => {
    if (!vivo || !aoRessincronizar || !jaLigou) return;
    if (timerResync) return;
    const desdeUltimo = Date.now() - ultimoResync;
    const espera = Math.max(0, 1500 - desdeUltimo) + Math.random() * 800;
    timerResync = setTimeout(() => {
      timerResync = null;
      if (!vivo) return;
      ultimoResync = Date.now();
      Promise.resolve(aoRessincronizar()).catch(err => {
        console.warn(`[realtime] ressincronização falhou (${motivo})`, err);
      });
    }, espera);
  };

  const armarVigia = (ms = VIGIA_MS) => {
    if (vigia) clearTimeout(vigia);
    vigia = setTimeout(() => {
      vigia = null;
      if (!vivo || conexao.ligada) return;
      // Passou da janela de retentativa e continua fora. Ou o phoenix desistiu
      // (caso terminal do binding mismatch), ou está preso — refazer o canal
      // do zero é barato e resolve os dois.
      console.warn(`[realtime] ${canal} não voltou sozinho; refazendo o canal`);
      montar();
    }, ms);
  };

  const montar = () => {
    if (!vivo) return;
    if (ch) {
      supabase.removeChannel(ch);
      ch = null;
    }
    // Sufixo aleatório: `supabase.channel(nome)` devolve o canal EXISTENTE
    // quando o nome se repete (confirmado no realtime-js 2.105.4). Sem o
    // sufixo, remontar a tela — ou este próprio vigia — cairia no canal antigo
    // e o `.subscribe()` viraria no-op silencioso, porque ele só age se o
    // canal estiver fechado.
    let c = supabase.channel(`${canal}-${crypto.randomUUID().slice(0, 8)}`);
    for (const a of assinaturas) {
      for (const ev of a.eventos ?? TODOS_EVENTOS) {
        const cfg = {
          event: ev,
          schema: 'public',
          table: a.tabela,
          ...(a.filtro && ev !== 'DELETE' ? { filter: a.filtro } : {}),
        };
        c = c.on('postgres_changes' as any, cfg as any, (payload: any) => {
          if (!vivo) return;
          if (a.bruto) a.bruto(payload);
          if (a.aoMudar) anotar(a, ev, ev === 'DELETE' ? payload.old?.id : payload.new?.id);
        });
      }
    }
    c.subscribe((status: string) => {
      if (!vivo) return;
      if (status === 'SUBSCRIBED') {
        if (vigia) { clearTimeout(vigia); vigia = null; }
        marcar(true);
        // Voltou de um corte: o que passou no intervalo não é reenviado.
        if (jaLigou) ressincronizar('reconexão');
        jaLigou = true;
        return;
      }
      // CHANNEL_ERROR | TIMED_OUT | CLOSED. O phoenix reagenda sozinho; o
      // vigia só cobre o caso em que ele não volta.
      marcar(false);
      armarVigia();
    });
    ch = c;
  };

  // Aba escondida e rede caída são os dois jeitos de perder evento sem que o
  // canal sequer perceba (o navegador congela timers e socket em aba de fundo).
  // Na volta, reler é a única garantia.
  const aoVoltarAba = () => {
    if (document.visibilityState !== 'visible') return;
    ressincronizar('aba voltou');
    if (!conexao.ligada) armarVigia(VIGIA_CURTO_MS);
  };
  const aoVoltarRede = () => {
    ressincronizar('rede voltou');
    if (!conexao.ligada) armarVigia(VIGIA_CURTO_MS);
  };
  document.addEventListener('visibilitychange', aoVoltarAba);
  window.addEventListener('online', aoVoltarRede);

  montar();

  return () => {
    vivo = false;
    if (timer) clearTimeout(timer);
    if (vigia) clearTimeout(vigia);
    if (timerResync) clearTimeout(timerResync);
    document.removeEventListener('visibilitychange', aoVoltarAba);
    window.removeEventListener('online', aoVoltarRede);
    conexoes.delete(conexao);
    recalcular();
    if (ch) supabase.removeChannel(ch);
  };
}

/** Tira da lista os itens cujos ids foram excluídos. */
export const semRemovidos = <T extends { id: unknown }>(removidos: Set<string>) =>
  (prev: T[]): T[] => (removidos.size ? prev.filter(x => !removidos.has(String(x.id))) : prev);

/**
 * Aplica à lista em memória as linhas que voltaram frescas do banco, sem
 * recarregar o resto. Três coisas de uma vez:
 *
 *  - id alterado que VOLTOU: troca no lugar (o estoque novo do produto);
 *  - id alterado que NÃO voltou: saiu do escopo desta empresa, ou foi excluído
 *    entre o evento e a consulta — some da lista;
 *  - id que voltou e não estava na lista: entrou agora, e é inserido na ordem.
 *
 * `ordenar` só é usado quando há item novo: reordenar a lista inteira a cada
 * baixa de estoque seria trabalho jogado fora.
 */
export function mesclarAlterados<T extends { id: unknown }>(
  prev: T[],
  frescos: T[],
  alterados: Set<string>,
  ordenar?: (a: T, b: T) => number,
): T[] {
  const mapa = new Map(frescos.map(x => [String(x.id), x]));
  const conhecidos = new Set(prev.map(x => String(x.id)));
  const lista = prev
    .filter(x => !alterados.has(String(x.id)) || mapa.has(String(x.id)))
    .map(x => mapa.get(String(x.id)) ?? x);
  const novos = frescos.filter(x => !conhecidos.has(String(x.id)));
  if (novos.length === 0) return lista;
  const juntos = [...lista, ...novos];
  return ordenar ? juntos.sort(ordenar) : juntos;
}

/** Ordem alfabética em português — a que as listas de cadastro usam. */
export const porNome = <T extends { name?: unknown }>(a: T, b: T): number =>
  String(a.name ?? '').localeCompare(String(b.name ?? ''), 'pt-BR');
