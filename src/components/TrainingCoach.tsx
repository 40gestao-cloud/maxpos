/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TrainingCoach — camada de treinamento que se sobrepõe ao PDVModule.
 *
 * Estrutura:
 *   1) Menu de cenários (scenarioId === null) — o operador escolhe o quê treinar.
 *   2) Passo-a-passo do cenário escolhido — spotlight + balão canto sup. direito.
 *   3) Tela de conclusão do cenário — oferece "outro cenário" ou "sair".
 *
 * Nada é persistido no Supabase: quem controla isso é o PDVModule via isTraining.
 * O único efeito colateral aqui é marcar o cenário completo em localStorage
 * (via trainingProgress) para o Início mostrar badge "novo" quando ainda houver
 * cenários pendentes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { markCompleted, getCompleted, ScenarioId, ALL_SCENARIOS } from '../lib/trainingProgress';

export type CoachPDVState = {
  cashSession: unknown | null;
  cart: unknown[];
  checkoutMode: boolean;
  cashModalOpen: boolean;
  paymentsCount: number;
  changeModal: unknown | null;
  thankYouOpen: boolean;
  // Cenários extras
  cardPickerOpen: boolean;
  valePickerOpen: boolean;
  showInstallments: boolean;
  pixModalOpen: boolean;
  showClientPicker: boolean;
  sangriaModal: boolean;
  supModal: boolean;
  closeCashModal: boolean;
  // Cupom / correções / descontos
  postSaleReceipt: unknown | null;
  confirmDialog: unknown | null;
  discountModal: unknown | null;
  cpfModalOpen: boolean;
  priceQueryOpen: boolean;
  classicSearchOpen: boolean;
  suspendedSale: unknown | null;
  selectedCartIdx: number; // -1 = sem seleção; >=0 = índice do item selecionado
  // Campos usados por passos que precisam distinguir "confirmou" de "cancelou".
  // Sem eles, done: (s) => !s.xModalOpen dispara igual em Enter e em Esc.
  saleDiscount: number;         // > 0 = desconto no total aplicado
  itemDiscountCount: number;    // qtd de itens com discount > 0
  cashMovementsCount: number;   // sangrias + suprimentos EFETIVADOS neste turno
  cpfSetOnSale: boolean;        // cpfNota preenchido na venda atual
  // Item com QUANTIDADE > 1 ou decimal (peso). Alimenta o passo de multiplicação
  // (2*agua, 0,5*cafe) — bipar duas vezes o mesmo produto NÃO conta: precisa ser
  // uma única linha com qty > 1.
  hasMultiQuantityItem: boolean;
  // Diferença (contado − esperado) capturada NO INSTANTE do fechamento de caixa.
  // null enquanto não fechou. Usado para forçar prática de sobra/falta.
  lastCloseCashDiff: number | null;
  // Contador de pagamentos que vieram de valor PARCIAL (partialAmount preenchido).
  // Usado pelo passo de pagamento parcial para saber que o operador de fato
  // usou a divisão em vez de pagar o total inteiro.
  partialPaymentsCount: number;
  // Edições em pagamentos já lançados (commitEditPayment mudou o valor).
  paymentEditsCount: number;
};

type Step = {
  id: string;
  target: string | null; // CSS selector; null = balão centralizado
  title: string;
  body: string;
  hint?: string;
  done: (s: CoachPDVState, prev: CoachPDVState | null) => boolean;
  // Se retornar true, o coach volta 1 passo (para o passo anterior deste track).
  // Usado quando um passo depende de estado transitório (ex.: confirmDialog
  // aberto) e o operador pode fechar por engano — sem isso o passo fica travado.
  rewind?: (s: CoachPDVState, prev: CoachPDVState | null) => boolean;
};

type Track = {
  id: ScenarioId;
  title: string;
  icon: string;
  description: string;
  color: string; // cor de destaque no card do menu
  steps: Step[];
};

// ═══════════════════ TRACKS ═══════════════════
// Cada track é auto-contido: nada de dependência entre eles. O operador pode
// pular ou repetir na ordem que quiser. Texto pensado pra quem NUNCA usou PDV.

// Passos compartilhados usados em todas as vendas.

// Aparece após o operador escolher a forma de pagamento e completar o valor.
// O PDV abre um card de "CONFIRMAR VENDA" (padrão de dupla-confirmação: evita
// venda finalizada por engano). Este passo explica esse card.
const reviewSaleStep: Step = {
  id: 'review-sale',
  target: '[data-training-target="confirm-dialog"]',
  title: 'Revisar e confirmar',
  body:
    'Uma janela verde apareceu pedindo REVISÃO da venda: mostra o total e o valor recebido. É a última chance de perceber um erro.\n\nO botão CONFIRMAR VENDA já vem destacado (o sistema entende que você quer fechar). Aperte ENTER para confirmar.',
  hint:
    'Se algo estiver errado: Tab (ou seta ←) foca em VOLTAR, Enter volta. Nunca aperte Enter no "reflexo" sem olhar — é assim que se fecha venda torta.',
  done: (s) => s.postSaleReceipt !== null,
};

// Aparece após finalizar. Explica o cupom não fiscal e a impressão.
const receiptStep: Step = {
  id: 'receipt-print',
  target: '[data-training-target="post-sale-receipt"]',
  title: 'Cupom não fiscal',
  body:
    'Toda venda gera um comprovante — o cupom. Ele lista os itens, formas de pagamento e valores. Você tem 2 opções agora:\n\n• Aperte P para baixar o cupom em PDF (backup em disco).\n• Aperte Enter para continuar sem baixar.\n\nNo balcão real, a impressora térmica imprime sozinha em paralelo.',
  hint: 'Uma cópia física do cupom evita discussões — quando o cliente pergunta o preço de um item horas depois, você tem a resposta.',
  done: (s) => s.thankYouOpen,
};

const scanFirst: Step = {
  id: 'scan-first',
  target: '[data-training-target="code-input"]',
  title: 'Ler o 1º produto',
  body:
    'No balcão de verdade, você aponta o leitor de código de barras para a etiqueta do produto — ele "bipa" e a linha aparece na lista. Aqui não temos leitor: digite "agua" (R$3), "pao" (R$1) ou "cafe" (R$12) no campo CÓDIGO e aperte ENTER.',
  hint:
    'Dica: para lançar QUANTIDADE, digite "2*agua" (2 unidades) ou "0,5*cafe" (meio kg em produto por peso). O * multiplica.',
  done: (s) => s.cart.length >= 1,
};

const goCheckout: Step = {
  id: 'go-checkout',
  target: '[data-training-target="code-input"]',
  title: 'Ir para o fechamento',
  body:
    'Depois de bipar todos os itens, você vai para a tela de RECEBER (fechamento). Com o campo CÓDIGO vazio, aperte ENTER — ou F4. Padrão supermercado (Bematech/Linx).',
  hint: 'O botão verde FECHAR VENDA no canto inferior direito faz o mesmo, se você preferir clicar.',
  done: (s) => s.checkoutMode,
};

const TRACK_CASH_BASIC: Track = {
  id: 'cash-basic',
  title: 'Venda com dinheiro (a mais comum)',
  icon: '💵',
  color: '#15803d',
  description: 'O clássico: bipa, fecha, recebe dinheiro, dá o troco, entrega o cupom. Começa por aqui.',
  steps: [
    scanFirst,
    {
      id: 'scan-quantity',
      target: '[data-training-target="code-input"]',
      title: 'Bipa uma QUANTIDADE (2*produto)',
      body:
        'Cliente quer 3 pães? Em vez de bipar 3x, digite "3*pao" e Enter — o asterisco (*) multiplica. Aparece uma linha só com QTD 3.',
      hint:
        'Balança/peso: "0,350*cafe" registra 350 g. O sistema aceita decimal com vírgula. Para código de barras real, o padrão é "N°EAN" — igual, mas com o EAN completo em vez do apelido.',
      done: (s) => s.hasMultiQuantityItem,
    },
    {
      id: 'scan-more',
      target: '[data-training-target="code-input"]',
      title: 'Adicione mais 1 item',
      body:
        'No dia a dia, o operador bipa vários produtos em sequência. Bipa mais um (tente "cafe") — repare que o TOTAL A PAGAR sobe automaticamente no canto direito.',
      hint:
        'Bipar o MESMO produto 2 vezes NÃO cria duas linhas — soma na linha existente (agua bipada 2x fica "AGUA · QTD 2"). Se estiver em dúvida, prefira "N*produto".',
      done: (s) => s.cart.length >= 2,
    },
    goCheckout,
    {
      id: 'pick-cash',
      target: '[data-pay-method="dinheiro"]',
      title: 'Aperte F1 — Dinheiro',
      body:
        'No fechamento você escolhe COMO o cliente vai pagar. As teclas F1/F2/F3 são atalhos:\n\n• F1 = Dinheiro (abre um cálculo de troco)\n• F2 = Cartão (crédito ou débito)\n• F3 = PIX ou Vale-Alimentação\n\nAperte F1 agora.',
      done: (s) => s.cashModalOpen,
    },
    {
      id: 'confirm-cash',
      target: '[data-training-target="cash-modal"]',
      title: 'Digite o valor recebido',
      body:
        'Digite QUANTO o cliente entregou (ex.: se o total é R$ 4 e ele deu uma nota de R$ 20, digite "20"). O sistema calcula o TROCO automaticamente. Aperte ENTER para confirmar.',
      hint: 'Se o cliente der o valor EXATO, o sistema já traz esse valor preenchido — só apertar Enter.',
      done: (s) => s.paymentsCount > 0,
    },
    reviewSaleStep,
    {
      id: 'change',
      target: '[data-training-target="change-modal"]',
      title: 'Devolver o troco',
      body:
        'Se houver troco, o sistema mostra em tela GIGANTE para o cliente conferir de longe. Você retira o valor da gaveta, entrega ao cliente, e aperte ENTER para seguir.\n\n(Se você deu o valor exato, essa tela nem aparece — o passo pula sozinho.)',
      done: (s) => s.postSaleReceipt !== null && !s.changeModal,
    },
    receiptStep,
  ],
};

const TRACK_CARD: Track = {
  id: 'card',
  title: 'Cartão de crédito e débito',
  icon: '💳',
  color: '#172554',
  description: 'Duas vendas seguidas: 1ª em CRÉDITO parcelado (3x), 2ª em DÉBITO à vista. Mesmo atalho F2, escolhas diferentes no picker.',
  steps: [
    scanFirst,
    goCheckout,
    {
      id: 'press-f2',
      target: '[data-pay-method="credito"]',
      title: 'Aperte F2 — Cartão',
      body:
        'F2 é o atalho para PAGAMENTO EM CARTÃO. Aperte F2 agora — um pequeno menu vai aparecer perguntando se é CRÉDITO ou DÉBITO.',
      done: (s) => s.cardPickerOpen,
    },
    {
      id: 'pick-credit',
      target: '[data-pay-method="credito"]',
      title: 'Escolha CRÉDITO',
      body:
        'Use as setas ↑↓ para percorrer as opções (CRÉDITO / DÉBITO) e aperte ENTER em CRÉDITO. O crédito abre a escolha de parcela.',
      hint: 'Débito não parcela — cai direto na revisão. Vamos praticar débito na 2ª venda logo em seguida.',
      done: (s) => s.showInstallments,
    },
    {
      id: 'pick-installments',
      target: '[data-training-target="installments-modal"]',
      title: 'Escolha em quantas vezes',
      body:
        'Cliente pediu para parcelar em 3x? Você tem 3 formas de escolher:\n\n• Digite o número (ex.: "3" — atalho de 1 tecla)\n• Use ↑↓ ← → e ENTER\n• Clique com o mouse\n\nEscolha o parcelamento agora.',
      hint: 'Cada opção mostra o valor de CADA parcela ao lado (ex.: 3x R$ 4,00).',
      done: (s) => s.paymentsCount > 0,
    },
    reviewSaleStep,
    receiptStep,
    // ─── 2ª venda — DÉBITO ────────────────────────────────────────
    {
      id: 'scan-debit',
      target: '[data-training-target="code-input"]',
      title: '2ª venda — bipa 1 item',
      body: 'Nova venda: cliente vai pagar em DÉBITO à vista. Bipa "agua" (ou qualquer produto).',
      done: (s) => s.cart.length >= 1,
    },
    { ...goCheckout, id: 'go-checkout-debit' },
    {
      id: 'press-f2-debit',
      target: '[data-pay-method="credito"]',
      title: 'F2 de novo',
      body: 'Mesma tecla F2 abre o picker CRÉDITO / DÉBITO.',
      done: (s) => s.cardPickerOpen,
    },
    {
      id: 'pick-debit',
      target: '[data-pay-method="credito"]',
      title: 'Desça para DÉBITO',
      body:
        'Aperte ↓ (ou Tab) para focar em DÉBITO e Enter. Débito NÃO abre modal de parcelas — o pagamento entra direto e você vai pra revisão.',
      hint: 'No supermercado real, aqui o cliente digita a senha na maquininha. Como treinamento, entra automático.',
      done: (s) => s.paymentsCount > 0,
    },
    { ...reviewSaleStep, id: 'review-sale-debit' },
    { ...receiptStep, id: 'receipt-print-debit' },
  ],
};

const TRACK_PARTIAL: Track = {
  id: 'partial',
  title: 'Pagamento parcial (dividir formas)',
  icon: '🔀',
  color: '#0369a1',
  description:
    'Cliente vai pagar parte em dinheiro e o resto no cartão. Muito comum: "só tenho R$ 5 na mão, passa o resto".',
  steps: [
    {
      id: 'scan-two-partial',
      target: '[data-training-target="code-input"]',
      title: 'Monta uma venda de R$ 15',
      body:
        'Bipa "cafe" (R$ 12) e "agua" (R$ 3) — dois itens somando R$ 15. Cliente falou que só tem R$ 5 em dinheiro; o resto (R$ 10) vai no cartão.',
      done: (s) => s.cart.length >= 2,
    },
    { ...goCheckout, id: 'go-checkout-partial' },
    {
      id: 'partial-cash',
      target: '[data-pay-method="dinheiro"]',
      title: 'VALOR PARCIAL 5,00 → F1',
      body:
        'No checkout, à esquerda dos botões de pagamento, tem o campo VALOR PARCIAL. Digite 5,00 nele. Depois F1 — o modal de dinheiro abre já com 5,00. Enter confirma. Sobra R$ 10 no TOTAL A PAGAR.',
      hint:
        'Sem valor parcial preenchido, a forma leva o RESTANTE inteiro. Com valor parcial, ela leva só o que você digitou.',
      done: (s) => s.partialPaymentsCount > 0,
    },
    {
      id: 'pay-rest-card',
      target: '[data-pay-method="credito"]',
      title: 'F2 → CRÉDITO para o restante',
      body:
        'Agora o campo parcial ficou vazio de novo — a próxima forma leva o RESTANTE (R$ 10). Aperte F2, escolha CRÉDITO com Enter, e escolha 1x (ou o número que preferir).',
      hint: 'Podia ser F1 (mais dinheiro), F2 débito, F3 PIX/Vale, F3 fiado — qualquer forma serve pra fechar. Aqui usamos crédito só pra praticar o F2.',
      done: (s) => s.paymentsCount >= 2,
    },
    reviewSaleStep,
    receiptStep,
  ],
};

const TRACK_PIX: Track = {
  id: 'pix',
  title: 'PIX (pagamento por QR Code)',
  icon: '⚡',
  color: '#0f766e',
  description:
    'Cliente vai pagar por PIX apontando o celular pro QR Code. No supermercado de verdade, o app MaxBank confirma o pagamento sozinho. Aqui simulamos manualmente.',
  steps: [
    scanFirst,
    goCheckout,
    {
      id: 'press-f3',
      target: '[data-pay-method="pix"]',
      title: 'Aperte F3 — PIX/Vale',
      body:
        'F3 é o atalho para PAGAMENTOS DIGITAIS: PIX ou Vale-Alimentação. Aperte F3 agora — vai aparecer um menu com as duas opções.',
      done: (s) => s.valePickerOpen,
    },
    {
      id: 'pick-pix',
      target: '[data-pay-method="pix"]',
      title: 'Escolha PIX',
      body:
        'Use ↑↓ e ENTER em PIX. Um QR Code enorme aparece na tela. O cliente aponta a câmera do celular (app do banco) para o QR e confirma o pagamento no celular.',
      done: (s) => s.pixModalOpen,
    },
    {
      id: 'confirm-pix',
      target: '[data-training-target="pix-modal"]',
      title: 'Aguardar confirmação',
      body:
        'No supermercado real: assim que o cliente paga no celular, o MaxBank avisa o PDV e a venda finaliza sozinha.\n\nAqui no treinamento: aperte ENTER (ou clique PAGAMENTO RECEBIDO) para simular a confirmação do MaxBank.',
      done: (s) => s.paymentsCount > 0,
    },
    reviewSaleStep,
    receiptStep,
  ],
};

const TRACK_FIADO: Track = {
  id: 'fiado',
  title: 'Fiado (o cliente leva agora e paga depois)',
  icon: '📒',
  color: '#b8860b',
  description:
    'Cliente conhecido tem uma "conta na venda". Você lança a venda no nome dele e ele quita depois. Sistema controla o limite de crédito.',
  steps: [
    scanFirst,
    goCheckout,
    {
      id: 'click-fiado',
      target: '[data-pay-method="fiado"]',
      title: 'Escolha FIADO',
      body:
        'Duas formas de chegar no fiado — escolha a mais rápida:\n\n• Rápido (recomendado): F3 abre o picker PIX/VALE/FIADO, ↓↓ desce até FIADO, Enter.\n• Manual: Tab (ou setas ← →) até o botão FIADO ficar destacado, Enter.\n\nUma lista de clientes vai aparecer.',
      done: (s) => s.showClientPicker,
    },
    {
      id: 'pick-client',
      target: '[data-training-target="client-picker"]',
      title: 'Escolha o cliente',
      body:
        'Use ↑↓ para percorrer os clientes e ENTER para confirmar. No treinamento só existe "Cliente Treinamento" — no real seriam dezenas ou centenas.\n\nDica: você pode DIGITAR o nome para filtrar rapidamente.',
      hint:
        'No supermercado de verdade: se o cliente estourou o limite de crédito, o sistema BLOQUEIA a venda e você precisa recusar. Nunca "empurre" fiado além do limite — depois vira prejuízo.',
      done: (s) => s.paymentsCount > 0,
    },
    reviewSaleStep,
    receiptStep,
  ],
};

// ─── NOVO — Corrigir erros ───────────────────────────────────────
const TRACK_FIX_MISTAKE: Track = {
  id: 'fix-mistake',
  title: 'Corrigir erros na venda',
  icon: '↩️',
  color: '#b91c1c',
  description:
    'Bipou item errado? Cliente desistiu do produto? Cliente desistiu de TUDO? Aqui você aprende a corrigir cada caso.',
  steps: [
    {
      id: 'scan-two',
      target: '[data-training-target="code-input"]',
      title: 'Bipa 2 itens para praticar',
      body:
        'Vamos simular uma venda com erro. Bipa DOIS produtos diferentes:\n\n1. Digite "agua" e Enter\n2. Digite "pao" e Enter\n\nA lista à esquerda mostra os 2 itens. A ÚLTIMA linha lida fica em amarelo claro.',
      done: (s) => s.cart.length >= 2,
    },
    {
      id: 'navigate-cart',
      target: '[data-training-target="code-input"]',
      title: 'Percorrer o carrinho com ↑↓',
      body:
        'Cliente disse "esse pão eu não quero mais"? Você precisa apagar SÓ o pão, sem cancelar a venda inteira. Como escolher qual apagar:\n\n• Com o campo CÓDIGO vazio, aperte ↑ e ↓\n• A linha selecionada fica em AMARELO FORTE\n• Vá selecionando (qualquer item já vale)',
      hint: 'Se você apertar Esc, a seleção some e as próximas ações voltam a mirar o ÚLTIMO item.',
      done: (s) => s.selectedCartIdx >= 0,
    },
    {
      id: 'delete-selected',
      target: '[data-training-target="code-input"]',
      title: 'Del apaga o item SELECIONADO',
      body:
        'Com um item destacado em amarelo, aperte a tecla DELETE (Del) no teclado. A linha some da lista e o TOTAL A PAGAR cai automaticamente.',
      hint:
        'Importante: o campo CÓDIGO precisa estar VAZIO. Se sobrou algo digitado, aperte Esc uma vez para limpar antes do Del. (Se você digitou algo, Del apaga letras primeiro — igual editar texto.) Sem nenhum item selecionado, Del apaga o ÚLTIMO bipado — o caso mais comum de "ops, li errado".',
      done: (s) => s.cart.length <= 1,
    },
    {
      id: 'add-one-more',
      target: '[data-training-target="code-input"]',
      title: 'Bipa mais 1 item',
      body: 'Agora imagine que o cliente escolheu outra coisa. Bipa "cafe" para simular esse novo produto.',
      done: (s) => s.cart.length >= 2,
    },
    {
      id: 'cancel-all',
      target: '[data-training-target="code-input"]',
      title: 'Cliente desistiu de TUDO?',
      body:
        'Às vezes o cliente muda de ideia no meio da compra. Aperte F9 para cancelar a venda INTEIRA — vai aparecer uma janela de CONFIRMAÇÃO (segurança contra apertar F9 sem querer).',
      done: (s) => s.confirmDialog !== null,
    },
    {
      id: 'confirm-cancel',
      target: '[data-training-target="confirm-dialog"]',
      title: 'Confirmar o cancelamento',
      body:
        'Na janela de confirmação:\n\n• Use ← → ou Tab para escolher CANCELAR VENDA / VOLTAR\n• Enter aceita a opção destacada\n\nRepare: o botão VOLTAR já veio destacado (variante "perigo" — cancelar é ação destrutiva). Você precisa mover para CANCELAR VENDA e Enter.',
      hint:
        'Esse detalhe evita perder venda por reflexo: se você apertar Enter sem olhar, ele VOLTA em vez de cancelar. Se fechar por engano, aperte F9 de novo. Em ações "sucesso" (como confirmar venda), acontece o inverso — o botão principal já vem destacado.',
      done: (s) => s.cart.length === 0 && s.confirmDialog === null,
      // Fechou o dialog sem zerar o carrinho? Foi VOLTAR/Esc por reflexo.
      // Volta ao passo cancel-all para o operador reabrir com F9.
      rewind: (s, prev) => prev !== null && prev.confirmDialog !== null && s.confirmDialog === null && s.cart.length > 0,
    },
  ],
};

// ─── NOVO — Descontos ────────────────────────────────────────────
const TRACK_DISCOUNT: Track = {
  id: 'discount',
  title: 'Aplicar descontos',
  icon: '🏷️',
  color: '#b8860b',
  description:
    'Cliente pediu desconto? Você pode dar um "quebra" no item específico (F6 na leitura) ou no total da venda (F6 no fechamento). Aceita R$ ou %.',
  steps: [
    {
      id: 'scan-item',
      target: '[data-training-target="code-input"]',
      title: 'Bipa 1 item mais caro',
      body: 'Vamos praticar com o "cafe" (R$ 12). Digite "cafe" e Enter.',
      done: (s) => s.cart.length >= 1,
    },
    {
      id: 'press-f6-item',
      target: '[data-training-target="code-input"]',
      title: 'F6 — Desconto no ITEM',
      body:
        'Na tela de leitura, F6 abre desconto no ÚLTIMO item lido. Use para casos tipo "esse produto está com data curta, faz desconto?". Aperte F6 agora.',
      hint: 'Se você tiver percorrido o carrinho com ↑↓, F6 aplica no item SELECIONADO (não no último). Igual ao Del.',
      done: (s) => s.discountModal !== null,
    },
    {
      id: 'apply-percent',
      target: '[data-training-target="discount-modal"]',
      title: 'Troque para % e digite 10',
      body:
        'O foco já está no campo VALOR. Para trocar de R$ para percentual, aperte a tecla % (ou $ para voltar a reais).\n\nDepois digite 10 e Enter. O café cai de R$ 12 para R$ 10,80 (12 − 10%).',
      hint: 'Prefere valor em reais? Não troque — só digite 2,00 e Enter para tirar exatos R$ 2 (o modo padrão é R$).',
      // Só avança se o modal fechou E o desconto foi realmente aplicado
      // (Esc/CANCELAR fecha o modal mas não incrementa itemDiscountCount).
      done: (s, prev) => prev !== null && prev.discountModal !== null && s.discountModal === null && s.itemDiscountCount > prev.itemDiscountCount,
    },
    {
      id: 'scan-more',
      target: '[data-training-target="code-input"]',
      title: 'Adicione mais 1 item',
      body: 'Bipa "agua" para termos uma segunda linha. Agora vamos ao desconto no TOTAL da venda.',
      done: (s) => s.cart.length >= 2,
    },
    goCheckout,
    {
      id: 'press-f6-total',
      target: '[data-extra-action="desconto"]',
      title: 'F6 — Desconto no TOTAL',
      body:
        'Na tela de FECHAMENTO, F6 abre desconto no TOTAL da venda (não em item específico). É a "quebra do troco" que o dono aprova: "R$ 12,80 fica R$ 12". Aperte F6.',
      done: (s) => s.discountModal !== null,
    },
    {
      id: 'apply-total-discount',
      target: '[data-training-target="discount-modal"]',
      title: 'Digite R$ 0,80 de desconto',
      body: 'Deixe em "R$ (Reais)", digite 0,80 e Enter. O total cai.',
      hint: 'O sistema não deixa você aplicar desconto MAIOR que o valor — evita venda com total negativo.',
      done: (s, prev) => prev !== null && prev.discountModal !== null && s.discountModal === null && s.saleDiscount > 0,
    },
    {
      id: 'finish-cash-f1',
      target: '[data-pay-method="dinheiro"]',
      title: 'Fecha com F1 dinheiro',
      body: 'Aperte F1 e depois Enter no valor exato (já vem preenchido). Isso lança o pagamento.',
      done: (s) => s.paymentsCount > 0,
    },
    reviewSaleStep,
    receiptStep,
  ],
};

// ─── NOVO — Corrigir pagamento já lançado ───────────────────────
const TRACK_FIX_PAYMENT: Track = {
  id: 'fix-payment',
  title: 'Corrigir pagamento errado',
  icon: '✏️',
  color: '#0e7490',
  description:
    'Lançou pagamento com valor errado? Cliente trocou de ideia sobre a forma? Aqui você aprende a EDITAR (lápis) e REMOVER (lixeira) sem cancelar a venda.',
  steps: [
    {
      id: 'scan-two-fix',
      target: '[data-training-target="code-input"]',
      title: 'Monta uma venda de R$ 15',
      body: 'Bipa "cafe" (R$ 12) e "agua" (R$ 3).',
      done: (s) => s.cart.length >= 2,
    },
    { ...goCheckout, id: 'go-checkout-fix' },
    {
      id: 'wrong-partial',
      target: '[data-pay-method="dinheiro"]',
      title: 'Digite VALOR PARCIAL 5,00 e F1',
      body:
        'Cliente falou R$ 3 em dinheiro, mas você digitou 5,00 no campo VALOR PARCIAL por engano. Faça isso agora: 5,00 no parcial, F1 Enter no modal de dinheiro. Pagamento lançado errado.',
      done: (s) => s.partialPaymentsCount > 0,
    },
    {
      id: 'edit-payment',
      target: '[data-training-target="payments-list"]',
      title: 'Corrige com o LÁPIS',
      body:
        'No card do pagamento em Dinheiro (à esquerda), clique no ícone LÁPIS (azul). O valor vira editável. Digite 3,00 e Enter — o pagamento cai para R$ 3. Repare que o TOTAL A PAGAR sobe de novo (falta R$ 12).',
      hint: 'Edição só faz sentido em valores digitados por você (dinheiro, PIX, vale). Cartão parcelado é melhor remover e refazer, senão o número de parcelas fica errado.',
      done: (s, prev) => prev !== null && s.paymentEditsCount > prev.paymentEditsCount,
    },
    {
      id: 'wrong-credit',
      target: '[data-pay-method="credito"]',
      title: 'Fecha o resto em CRÉDITO 3x (também errado!)',
      body:
        'Agora o cliente disse "3x no cartão". F2 → CRÉDITO → 3. Payment lançado. Só que — cliente se confundiu, era DÉBITO. Precisa desfazer.',
      done: (s) => s.paymentsCount >= 2,
    },
    {
      id: 'remove-payment',
      target: '[data-training-target="payments-list"]',
      title: 'Remove o crédito com a LIXEIRA',
      body:
        'No card do pagamento em Crédito, clique no ícone LIXEIRA (vermelho). Ele some da lista. Restou só o dinheiro de R$ 3, e o TOTAL A PAGAR volta a mostrar R$ 12 faltando.',
      hint: 'Lixeira ≠ Cancelar Venda. Lixeira remove SÓ um pagamento; itens do carrinho ficam. F9 é que cancela tudo.',
      done: (s, prev) => prev !== null && s.paymentsCount < prev.paymentsCount,
    },
    {
      id: 'pay-debit-fix',
      target: '[data-pay-method="credito"]',
      title: 'Agora F2 → DÉBITO',
      body: 'F2, ↓ para DÉBITO, Enter. Pagamento correto lançado.',
      done: (s) => s.paymentsCount >= 2,
    },
    reviewSaleStep,
    receiptStep,
  ],
};

// ─── NOVO — Situações do balcão ──────────────────────────────────
const TRACK_EXTRAS: Track = {
  id: 'extras',
  title: 'Consulta, busca, gancheira e CPF',
  icon: '🛎️',
  color: '#7c3aed',
  description:
    '4 operações que acontecem TODO DIA no balcão: consultar preço, buscar produto por nome, suspender venda para atender outro cliente, e pôr CPF na nota.',
  steps: [
    {
      id: 'press-f7',
      target: '[data-training-target="code-input"]',
      title: 'F7 — Consulta de preço',
      body:
        'Cliente ainda está decidindo e pergunta "quanto custa a água?". Você NÃO bipa ainda — só consulta. F7 abre a Consulta de Preço. Aperte F7.',
      hint: 'A F7 mostra preço e estoque sem lançar no carrinho — perfeita para responder rapidinho.',
      done: (s) => s.priceQueryOpen,
    },
    {
      id: 'close-f7',
      target: '[data-training-target="price-query"]',
      title: 'Digite algo, veja o preço e feche',
      body:
        'Digite "agua" ou "cafe" no campo. O sistema mostra o preço em fonte grande e o estoque. Depois aperte Esc para fechar.',
      done: (s) => !s.priceQueryOpen,
    },
    {
      id: 'press-f8',
      target: '[data-training-target="code-input"]',
      title: 'F8 — Buscar produto por nome',
      body:
        'Etiqueta rasgada, código não bipa, cliente não sabe o nome exato? F8 (ou F10) abre a busca. Aperte F8 agora.',
      done: (s) => s.classicSearchOpen,
    },
    {
      id: 'search-add',
      target: '[data-training-target="search-modal"]',
      title: 'Busque e adicione',
      body:
        'Digite parte do nome (ex.: "sabo" para achar "Sabonete"). Use ↑↓ para escolher na lista e Enter — o item vai pro carrinho.',
      done: (s) => !s.classicSearchOpen && s.cart.length >= 1,
    },
    {
      id: 'suspend',
      target: '[data-training-target="code-input"]',
      title: 'Suspender venda — Ctrl+G',
      body:
        'Cliente esqueceu o dinheiro em casa? Vai buscar? Você NÃO pode deixar a fila parada. SUSPENDE a venda: os itens ficam "no ar" e você atende o próximo cliente.\n\nAperte Ctrl+G. (O botão SUSPENDER no canto inferior faz o mesmo, se preferir clicar.)',
      hint: 'O nome "gancheira" vem do supermercado: literalmente um gancho onde o operador pendura o cupom pausado. Ctrl+G = Gancheira.',
      done: (s) => s.suspendedSale !== null && s.cart.length === 0,
    },
    {
      id: 'recall',
      target: '[data-training-target="code-input"]',
      title: 'Cliente voltou — Ctrl+G recupera',
      body:
        'Quando o cliente voltar, o botão amarelo RECUPERAR aparece no lugar do SUSPENDER. Aperte Ctrl+G de novo — os itens voltam para o carrinho intactos.',
      hint: 'Mesma tecla, mesmo motivo: se há venda no carrinho, Ctrl+G suspende; se há venda pendurada, Ctrl+G recupera.',
      done: (s) => s.suspendedSale === null && s.cart.length >= 1,
    },
    goCheckout,
    {
      id: 'press-f5-cpf',
      target: '[data-extra-action="desconto"]',
      title: 'CPF na nota (F5 → Tab → Enter)',
      body:
        'Cliente pediu CPF na nota para participar de sorteios/programas fiscais? No fechamento, os botões extras ficam à direita.\n\n1. Aperte F5 — o foco cai no primeiro botão, DESCONTO (é aqui que o spotlight está agora).\n2. Aperte Tab uma vez — passa para CPF NA NOTA.\n3. Aperte Enter — abre o modal.\n\nFaça a sequência agora.',
      done: (s) => s.cpfModalOpen,
    },
    {
      id: 'fill-cpf',
      target: '[data-training-target="cpf-modal"]',
      title: 'Digite um CPF e confirme',
      body:
        'Digite qualquer 11 dígitos (ex.: 12345678900). O sistema formata sozinho como 123.456.789-00. Enter confirma.',
      hint: 'Também aceita CNPJ (14 dígitos) para pessoa jurídica.',
      done: (s, prev) => prev !== null && prev.cpfModalOpen && !s.cpfModalOpen && s.cpfSetOnSale,
    },
    {
      id: 'finish-cash-extras',
      target: '[data-pay-method="dinheiro"]',
      title: 'Fecha com F1 dinheiro',
      body: 'Aperte F1 e Enter (valor exato já preenchido). Lança o pagamento.',
      done: (s) => s.paymentsCount > 0,
    },
    reviewSaleStep,
    receiptStep,
  ],
};

const TRACK_CASH_MGMT: Track = {
  id: 'cash-mgmt',
  title: 'Sangria, Suprimento e Fechar Caixa',
  icon: '🔒',
  color: '#7f1d1d',
  description: 'Gestão do dinheiro do caixa: reforço de troco, retirada e encerramento do turno. Este cenário fecha o treinamento.',
  steps: [
    {
      id: 'press-f11',
      target: '[data-training-target="code-input"]',
      title: 'F11 — Suprimento',
      body: 'Suprimento é entrada de dinheiro no caixa (reforço de troco, por ex.). Aperte F11.',
      done: (s) => s.supModal,
    },
    {
      id: 'fill-sup',
      target: '[data-training-target="suprimento-modal"]',
      title: 'Preencha e confirme',
      body: 'Digite um valor qualquer (ex.: R$ 30,00), Tab, digite um motivo curto (ex.: "reforço de troco") e aperte ENTER.',
      done: (s, prev) => prev !== null && prev.supModal && !s.supModal && s.cashMovementsCount > prev.cashMovementsCount,
    },
    {
      id: 'press-f12',
      target: '[data-training-target="code-input"]',
      title: 'F12 — Sangria',
      body: 'Sangria é saída de dinheiro (levar ao cofre etc.). Aperte F12.',
      done: (s) => s.sangriaModal,
    },
    {
      id: 'fill-sang',
      target: '[data-training-target="sangria-modal"]',
      title: 'Preencha e confirme',
      body: 'Mesmo esquema: valor, Tab, motivo (ex.: "levado ao cofre"), ENTER.',
      done: (s, prev) => prev !== null && prev.sangriaModal && !s.sangriaModal && s.cashMovementsCount > prev.cashMovementsCount,
    },
    {
      id: 'click-close',
      target: '[data-training-target="close-cash-btn"]',
      title: 'Fechar o caixa (Ctrl+L)',
      body:
        'Fim de turno: aperte Ctrl+L para iniciar o fechamento do caixa. O botão FECHAR CAIXA no topo direito faz o mesmo — o atalho é só o caminho pelo teclado.',
      done: (s) => s.closeCashModal,
    },
    {
      id: 'confirm-close',
      target: '[data-training-target="close-cash-modal"]',
      title: 'Praticar SOBRA ou FALTA',
      body:
        'O valor esperado já vem preenchido. Mas no dia real, o contado quase nunca bate exato. Apague e digite um valor DIFERENTE (ex.: R$ 1,00 A MAIS que o sugerido) e Enter. Vai aparecer "SOBRA" antes de confirmar.',
      hint:
        'FALTA (contado < esperado) e SOBRA (contado > esperado) viram relatório para o gerente investigar. Bater no exato é raro — se acontece sempre, geralmente é operador "arredondando" na cabeça em vez de contar.',
      // PDVModule bloqueia o fechamento exato no treino (mostra alerta e
      // mantém o modal aberto), então quando cashSession vira null aqui é
      // garantido que o operador digitou divergência real.
      done: (s) => s.cashSession === null && s.lastCloseCashDiff !== null && Math.abs(s.lastCloseCashDiff) > 0.001,
    },
  ],
};

const TRACKS: Record<ScenarioId, Track> = {
  'cash-basic': TRACK_CASH_BASIC,
  'card': TRACK_CARD,
  'pix': TRACK_PIX,
  'fiado': TRACK_FIADO,
  'fix-mistake': TRACK_FIX_MISTAKE,
  'fix-payment': TRACK_FIX_PAYMENT,
  'discount': TRACK_DISCOUNT,
  'partial': TRACK_PARTIAL,
  'extras': TRACK_EXTRAS,
  'cash-mgmt': TRACK_CASH_MGMT,
};

interface TrainingCoachProps {
  userId: string;
  state: CoachPDVState;
  onExit: () => void;
  // Chamado ao começar (ou voltar a) um cenário. PDVModule limpa cart, payments,
  // modais abertos etc. — evita que sobras do cenário anterior façam o passo 1
  // auto-avançar sem o operador ver a instrução.
  onScenarioStart?: () => void;
}

const YELLOW = '#FFC107';
const YELLOW_DARK = '#B8860B';
const NAVY_DARK = '#172554';

export default function TrainingCoach({ userId, state, onExit, onScenarioStart }: TrainingCoachProps) {
  const [scenarioId, setScenarioId] = useState<ScenarioId | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [showingDone, setShowingDone] = useState(false);
  const [completedSet, setCompletedSet] = useState<Set<ScenarioId>>(() => getCompleted(userId));
  // Guardo o estado anterior em ref (não gera re-render). Usado por passos que
  // dependem de "algo mudou de X pra Y" (ex.: modal abriu e fechou).
  // Se guardasse em useState, a atualização de prev iria re-executar o efeito
  // de auto-advance com prev = state atual — o clearTimeout do cleanup cancelaria
  // o setTimeout já agendado, e o passo travaria.
  const prevStateRef = useRef<CoachPDVState | null>(null);
  // Trava re-entrada: uma vez que done=true dispara o timeout, marcamos este
  // stepIdx e não cancelamos mesmo que o state flutue antes dos 350ms (ex.: modal
  // fecha por Esc logo após abrir). Sem isso, o cleanup do useEffect cancela o
  // timeout e o passo trava. É resetado ao mudar de step ou cenário.
  const advanceScheduledForStepRef = useRef<number>(-1);

  const track = scenarioId ? TRACKS[scenarioId] : null;
  const step = track ? track.steps[stepIdx] : null;

  // Auto-advance quando o step atual foi cumprido pela ação do operador.
  useEffect(() => {
    if (!track || !step || showingDone) return;
    const prev = prevStateRef.current;
    // Atualiza a referência ANTES do check (para o próximo tick já ter prev = state atual).
    // O prev usado no check é o que a closure capturou desta invocação.
    prevStateRef.current = state;
    // Rewind tem precedência sobre done — se o passo entrou em estado inválido,
    // volta ao anterior antes de checar avanço.
    if (step.rewind && stepIdx > 0 && step.rewind(state, prev)) {
      setStepIdx(i => Math.max(0, i - 1));
      return;
    }
    // Já agendou avanço para este step → não reagendar nem cancelar.
    if (advanceScheduledForStepRef.current === stepIdx) return;
    if (step.done(state, prev)) {
      advanceScheduledForStepRef.current = stepIdx;
      const total = track.steps.length;
      const isLast = stepIdx >= total - 1;
      const trackId = track.id;
      setTimeout(() => {
        if (isLast) {
          markCompleted(userId, trackId);
          setCompletedSet(new Set(getCompleted(userId)));
          setShowingDone(true);
        } else {
          setStepIdx(i => i + 1);
        }
      }, 350);
    }
  }, [state, step, track, stepIdx, showingDone, userId]);

  // Reset da trava ao mudar de step / cenário.
  useEffect(() => {
    advanceScheduledForStepRef.current = -1;
  }, [stepIdx, scenarioId]);

  const pickScenario = useCallback((id: ScenarioId) => {
    onScenarioStart?.();
    setScenarioId(id);
    setStepIdx(0);
    setShowingDone(false);
    prevStateRef.current = null; // será reatualizado no 1º render após o reset
  }, [onScenarioStart]);

  const backToMenu = useCallback(() => {
    onScenarioStart?.();
    setScenarioId(null);
    setStepIdx(0);
    setShowingDone(false);
  }, [onScenarioStart]);

  // ENTER na tela de conclusão de cenário. (O menu de cenários tem seu próprio
  // handler dentro de ScenarioMenu — evita registro duplo do mesmo shortcut.)
  useEffect(() => {
    if (!showingDone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      // cash-mgmt (terminal) → SAIR. Outros → OUTRO CENÁRIO.
      if (track && track.id === 'cash-mgmt') onExit();
      else backToMenu();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [track, showingDone, onExit, backToMenu]);

  // Deps do useTargetRect: só o que muda o layout do alvo. Passar `state` inteiro
  // faz JSON.stringify do carrinho a cada teclada — desperdício. O hook já ouve
  // resize+scroll+MutationObserver-like via polling, então state em si não
  // precisa entrar.
  const targetRect = useTargetRect(step?.target ?? null, [stepIdx, scenarioId]);
  const preludeRect = useTargetRect(
    (!track && !state.cashSession) ? '[data-training-target="open-cash-modal"]' : null,
    [!!state.cashSession]
  );

  // ─── Preludio: precisa abrir o caixa antes de escolher cenário ──
  if (!track && !state.cashSession) {
    return <OpenCashPrelude rect={preludeRect} onExit={onExit} />;
  }

  // ─── Tela 1: menu de cenários ──────────────────────────────────
  if (!track) {
    return <ScenarioMenu completedSet={completedSet} onPick={pickScenario} onExit={onExit} />;
  }

  // ─── Tela 3: cenário concluído ─────────────────────────────────
  if (showingDone) {
    const remaining = ALL_SCENARIOS.filter(id => !completedSet.has(id));
    // cash-mgmt fecha o caixa — outros cenários exigem caixa aberto para rodar.
    // Se voltasse ao menu aqui, ficaria tudo travado. Só oferecemos SAIR.
    const isTerminal = track.id === 'cash-mgmt';
    return (
      <div
        className="fixed inset-0 z-[500] flex items-center justify-center p-6"
        style={{ background: 'rgba(15,23,42,0.82)', fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        <div
          className="w-full max-w-lg bg-white border-4 shadow-2xl rounded-lg overflow-hidden"
          style={{ borderColor: track.color }}
        >
          <div className="px-5 py-4 flex items-center gap-3" style={{ background: track.color, color: 'white' }}>
            <span className="text-3xl">✓</span>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.3em] opacity-80">
                Cenário concluído
              </div>
              <div className="text-xl font-black leading-tight">
                {track.icon} {track.title}
              </div>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-base text-gray-800 leading-relaxed">
              {isTerminal
                ? 'O caixa foi fechado. Fim de turno! Para praticar outro cenário, entre no Modo Treinamento novamente pelo Início.'
                : `Parabéns! Você concluiu esse cenário. ${remaining.length > 0
                    ? `Faltam ${remaining.length} para concluir todos os cenários.`
                    : 'Você concluiu TODOS os cenários — está pronto para o balcão de verdade!'}`}
            </p>
            <div className="flex gap-3 pt-1">
              {isTerminal ? (
                <button
                  autoFocus
                  onClick={onExit}
                  className="flex-1 px-4 py-3 text-white font-bold uppercase text-sm tracking-wide"
                  style={{ background: NAVY_DARK }}
                >
                  SAIR (Enter)
                </button>
              ) : (
                <>
                  <button
                    onClick={onExit}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50 uppercase text-sm tracking-wide"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    SAIR
                  </button>
                  <button
                    autoFocus
                    onClick={backToMenu}
                    className="flex-1 px-4 py-3 text-white font-bold uppercase text-sm tracking-wide"
                    style={{ background: NAVY_DARK }}
                  >
                    OUTRO CENÁRIO (Enter)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Tela 2: passo do cenário (spotlight) ──────────────────────
  if (!step) return null;
  const hasTarget = !!targetRect;

  return (
    <div className="fixed inset-0 z-[500] pointer-events-none" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* Overlay em 4 pedaços deixando um buraco no alvo. Sem alvo → cobre a tela toda. */}
      {hasTarget ? (
        <>
          {/* pointer-events:none em cada faixa — o wrapper pointer-events-none
              não é herdado; filhos com default 'auto' bloqueiam cliques mesmo
              sob o overlay do coach. Sem isso o operador vê o input do CÓDIGO
              "travado" quando o spotlight cobre o resto da tela. */}
          <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: targetRect.top - 8, background: 'rgba(15,23,42,0.72)' }} />
          <div className="absolute left-0 pointer-events-none" style={{ top: targetRect.top - 8, height: targetRect.height + 16, width: targetRect.left - 8, background: 'rgba(15,23,42,0.72)' }} />
          <div className="absolute right-0 pointer-events-none" style={{ top: targetRect.top - 8, height: targetRect.height + 16, left: targetRect.left + targetRect.width + 8, background: 'rgba(15,23,42,0.72)' }} />
          <div className="absolute inset-x-0 pointer-events-none" style={{ top: targetRect.top + targetRect.height + 8, bottom: 0, background: 'rgba(15,23,42,0.72)' }} />
          <div
            className="absolute border-4 rounded-md pointer-events-none animate-pulse"
            style={{
              top: targetRect.top - 6,
              left: targetRect.left - 6,
              width: targetRect.width + 12,
              height: targetRect.height + 12,
              borderColor: YELLOW,
              boxShadow: '0 0 0 4px rgba(255,193,7,0.35)',
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(15,23,42,0.55)' }} />
      )}

      {/* Balão canto sup. direito */}
      <div className="absolute pointer-events-auto" style={{ top: 20, right: 20, maxWidth: 360 }}>
        <div className="bg-white border-4 shadow-2xl rounded-lg overflow-hidden" style={{ borderColor: YELLOW_DARK }}>
          <div className="px-4 py-2 flex items-center gap-2" style={{ background: YELLOW }}>
            <span className="text-lg">{track.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: NAVY_DARK, opacity: 0.75 }}>
                {track.title} · Passo {stepIdx + 1} de {track.steps.length}
              </div>
              <div className="text-sm font-black leading-tight truncate" style={{ color: NAVY_DARK }}>
                {step.title}
              </div>
            </div>
            <button
              tabIndex={-1}
              onClick={backToMenu}
              className="text-[10px] font-black px-2 py-1 border-2 hover:bg-black/10 uppercase tracking-wider"
              style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
              title="Voltar ao menu de cenários"
            >
              MENU
            </button>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-sm text-gray-800 leading-relaxed">{step.body}</p>
            {step.hint && (
              <p className="text-[11px] text-gray-500 italic border-l-2 pl-2" style={{ borderColor: YELLOW_DARK }}>
                {step.hint}
              </p>
            )}
            <div className="pt-1 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Avança sozinho quando você faz
              </span>
              {stepIdx < track.steps.length - 1 && (
                <button
                  tabIndex={-1}
                  onClick={() => setStepIdx(i => Math.min(i + 1, track.steps.length - 1))}
                  className="text-[10px] font-black px-2 py-1 border hover:bg-gray-50 uppercase tracking-wider"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                  title="Pular para o próximo passo"
                >
                  PRÓXIMO
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Preludio: guia a abertura do caixa antes do menu ───────────
function OpenCashPrelude({
  rect,
  onExit,
}: {
  rect: { top: number; left: number; width: number; height: number } | null;
  onExit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[500] pointer-events-none" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: rect.top - 8, background: 'rgba(15,23,42,0.72)' }} />
          <div className="absolute left-0 pointer-events-none" style={{ top: rect.top - 8, height: rect.height + 16, width: rect.left - 8, background: 'rgba(15,23,42,0.72)' }} />
          <div className="absolute right-0 pointer-events-none" style={{ top: rect.top - 8, height: rect.height + 16, left: rect.left + rect.width + 8, background: 'rgba(15,23,42,0.72)' }} />
          <div className="absolute inset-x-0 pointer-events-none" style={{ top: rect.top + rect.height + 8, bottom: 0, background: 'rgba(15,23,42,0.72)' }} />
          <div
            className="absolute border-4 rounded-md pointer-events-none animate-pulse"
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              borderColor: YELLOW,
              boxShadow: '0 0 0 4px rgba(255,193,7,0.35)',
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(15,23,42,0.55)' }} />
      )}
      <div className="absolute pointer-events-auto" style={{ top: 20, right: 20, maxWidth: 360 }}>
        <div className="bg-white border-4 shadow-2xl rounded-lg overflow-hidden" style={{ borderColor: YELLOW_DARK }}>
          <div className="px-4 py-2 flex items-center gap-2" style={{ background: YELLOW }}>
            <span className="text-lg">🎓</span>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: NAVY_DARK, opacity: 0.75 }}>
                Modo Treinamento · Antes de começar
              </div>
              <div className="text-sm font-black leading-tight" style={{ color: NAVY_DARK }}>
                Abra o caixa
              </div>
            </div>
            <button
              tabIndex={-1}
              onClick={onExit}
              className="text-[10px] font-black px-2 py-1 border-2 hover:bg-black/10 uppercase tracking-wider"
              style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
            >
              SAIR
            </button>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-sm text-gray-800 leading-relaxed">
              Todo turno começa abrindo o caixa: você informa o fundo de troco que já está na gaveta. Digite qualquer valor (ex.: <b>50,00</b>) e aperte <b>Enter</b>.
            </p>
            <p className="text-[11px] text-gray-500 italic border-l-2 pl-2" style={{ borderColor: YELLOW_DARK }}>
              Depois de abrir, o menu de cenários aparece e você escolhe o quê treinar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Menu de cenários ────────────────────────────────────────────
function ScenarioMenu({
  completedSet,
  onPick,
  onExit,
}: {
  completedSet: Set<ScenarioId>;
  onPick: (id: ScenarioId) => void;
  onExit: () => void;
}) {
  const [focusedIdx, setFocusedIdx] = useState(() => {
    const first = ALL_SCENARIOS.findIndex(id => !completedSet.has(id));
    return first === -1 ? 0 : first;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        setFocusedIdx(i => (i + 1) % ALL_SCENARIOS.length);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation();
        setFocusedIdx(i => (i - 1 + ALL_SCENARIOS.length) % ALL_SCENARIOS.length);
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        onPick(ALL_SCENARIOS[focusedIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        onExit();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusedIdx, onPick, onExit]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-6 overflow-y-auto"
      style={{ background: 'rgba(15,23,42,0.85)', fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <div className="w-full max-w-3xl bg-white border-4 shadow-2xl rounded-lg overflow-hidden my-6" style={{ borderColor: YELLOW_DARK }}>
        <div className="px-5 py-4 flex items-center gap-3" style={{ background: YELLOW }}>
          <span className="text-3xl">🎓</span>
          <div className="flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: NAVY_DARK, opacity: 0.7 }}>
              Modo Treinamento · {completedSet.size} de {ALL_SCENARIOS.length} concluídos
            </div>
            <div className="text-xl font-black leading-tight" style={{ color: NAVY_DARK }}>
              Escolha um cenário para praticar
            </div>
          </div>
          <button
            onClick={onExit}
            className="text-xs font-black px-3 py-1.5 border-2 hover:bg-black/10 uppercase tracking-wider rounded"
            style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
          >
            SAIR (Esc)
          </button>
        </div>
        <div className="p-5 space-y-3">
          {ALL_SCENARIOS.map((id, idx) => {
            const t = TRACKS[id];
            const done = completedSet.has(id);
            const focused = idx === focusedIdx;
            return (
              <button
                key={id}
                onClick={() => onPick(id)}
                onMouseEnter={() => setFocusedIdx(idx)}
                className={`w-full text-left p-4 border-2 rounded-lg flex items-start gap-4 transition ${
                  focused ? 'ring-4 ring-offset-2 ring-yellow-400 shadow-lg' : 'hover:bg-gray-50'
                }`}
                style={{ borderColor: focused ? t.color : '#e5e7eb', background: focused ? '#fef9e7' : 'white' }}
              >
                <div
                  className="w-14 h-14 rounded-lg flex items-center justify-center text-3xl shrink-0"
                  style={{ background: t.color, color: 'white' }}
                >
                  {t.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-black uppercase tracking-wide" style={{ color: NAVY_DARK }}>
                      {t.title}
                    </span>
                    {done && (
                      <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ background: '#15803d' }}>
                        ✓ FEITO
                      </span>
                    )}
                    {!done && idx === ALL_SCENARIOS.findIndex(sid => !completedSet.has(sid)) && (
                      <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: YELLOW, color: NAVY_DARK }}>
                        SUGERIDO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{t.description}</p>
                </div>
              </button>
            );
          })}
          <div className="text-center text-[11px] text-gray-500 pt-2 border-t border-gray-200 leading-relaxed">
            <b>↑↓</b> navegar · <b>Enter</b> escolher · <b>Esc</b> sair · <b>Ctrl+T</b> sair do treino a qualquer momento<br/>
            Dentro do PDV: <b>Shift+F1</b> abre a ajuda com todos os atalhos · Nada é salvo no banco real
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook: mede o bounding rect do alvo; refaz em resize/scroll e no primeiro
// render em que o alvo aparece (modal ainda montando).
function useTargetRect(selector: string | null, deps: unknown[]) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!selector) { setRect(null); return; }
    let cancelled = false;
    const measure = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) { setRect(null); return false; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { setRect(null); return false; }
      if (!cancelled) setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      return true;
    };
    let tries = 0;
    const interval = window.setInterval(() => {
      tries += 1;
      if (measure() || tries > 10) window.clearInterval(interval);
    }, 50);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, ...deps]);

  return rect;
}
