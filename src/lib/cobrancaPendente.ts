import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/**
 * Espera a confirmação de uma cobrança (PIX ou cartão) que outro sistema do
 * ecossistema vai marcar como paga — o MaxBank, o MaxPay ou a tela do
 * visitante. O PDV fica olhando UMA linha e reage quando ela muda.
 *
 * ─── Por que não é só Realtime ───
 *
 * Era. E o modo de falha era o pior possível: se o canal caísse enquanto o
 * modal estivesse aberto, o cliente pagava, o MaxBank marcava a linha como
 * paga, e o caixa continuava olhando "aguardando pagamento" para sempre. Nada
 * na tela dizia que a escuta tinha morrido. O operador só descobria
 * desconfiando, e o caminho de saída (o botão de confirmação manual) parece,
 * de fora, estar dando baixa num pagamento que ninguém viu chegar.
 *
 * Em dinheiro, esse silêncio não é aceitável. Então aqui são DOIS caminhos:
 *
 *  - Realtime é o caminho rápido: chega em milissegundos.
 *  - Uma consulta periódica é a REDE: pergunta o status da linha de tempos em
 *    tempos. Cobre o canal que caiu, o evento que se perdeu no intervalo e a
 *    aba que estava em segundo plano.
 *
 * O ritmo da rede acompanha a saúde do canal: com o Realtime de pé ela é rara
 * (só cobre buraco), e sem ele aperta, porque aí é o único caminho. Os dois
 * levam à MESMA confirmação, e ela acontece uma vez só — o `confirmado` corta
 * a corrida entre os dois.
 *
 * `aoVivo` sai para a tela poder avisar que a confirmação automática não está
 * funcionando, em vez de deixar o operador esperando sem saber.
 */

export interface Cobranca {
  tabela: 'pix_pendentes' | 'cartao_pendentes';
  id: string;
  /** Status que significa pago. PIX vira 'pago'; cartão vira 'autorizado'. */
  statusFinal: string;
}

/** Com o canal de pé a consulta é só rede de segurança. */
const INTERVALO_COM_REALTIME = 8000;
/** Sem canal ela é o único caminho, então aperta o passo. */
const INTERVALO_SEM_REALTIME = 2500;

export function useCobrancaPendente(
  cobranca: Cobranca | null,
  aoConfirmar: () => void,
): { aoVivo: boolean } {
  const [aoVivo, setAoVivo] = useState(false);

  // A confirmação mexe em estado do PDV (pagamentos, modal, auto-finalize), e
  // esse callback é recriado a cada render. Guardar no ref evita religar canal
  // e consulta a cada tecla digitada na tela.
  const confirmarRef = useRef(aoConfirmar);
  confirmarRef.current = aoConfirmar;

  useEffect(() => {
    if (!cobranca) { setAoVivo(false); return; }
    const { tabela, id, statusFinal } = cobranca;

    let vivo = true;
    let confirmado = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ligado = false;

    const confirmar = () => {
      if (confirmado || !vivo) return;
      confirmado = true;
      confirmarRef.current();
    };

    const conferir = async () => {
      if (!vivo || confirmado) return;
      try {
        const { data, error } = await supabase
          .from(tabela)
          .select('status')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if ((data as any)?.status === statusFinal) confirmar();
      } catch (err) {
        // Rede ruim é o cenário ESPERADO aqui — insistir em silêncio é o
        // comportamento certo, e a próxima passada tenta de novo.
        console.warn('[cobranca] falha ao conferir status', err);
      }
      agendar();
    };

    const agendar = () => {
      if (!vivo || confirmado) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(conferir, ligado ? INTERVALO_COM_REALTIME : INTERVALO_SEM_REALTIME);
    };

    // Sufixo aleatório: `supabase.channel(nome)` devolve o canal EXISTENTE
    // quando o nome se repete, e `.subscribe()` só age em canal fechado.
    // Reabrir o modal da MESMA cobrança antes de o canal anterior terminar de
    // fechar cairia no canal velho e a escuta viraria no-op silencioso.
    const canal = supabase
      .channel(`cobranca-${id}-${crypto.randomUUID().slice(0, 8)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: tabela, filter: `id=eq.${id}` },
        (payload: any) => {
          if (payload.new?.status === statusFinal) confirmar();
        },
      )
      .subscribe((status: string) => {
        if (!vivo) return;
        ligado = status === 'SUBSCRIBED';
        setAoVivo(ligado);
        // Reagenda no ritmo novo: se o canal acabou de cair, a rede assume já.
        agendar();
      });

    // Uma conferência de saída, antes de qualquer espera: a cobrança pode já
    // ter sido paga entre criar a linha e abrir esta escuta.
    conferir();

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(canal);
      setAoVivo(false);
    };
  }, [cobranca?.tabela, cobranca?.id, cobranca?.statusFinal]);

  return { aoVivo };
}
