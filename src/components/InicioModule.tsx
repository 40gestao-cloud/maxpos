/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User } from '../types';
import { getCompleted, ALL_SCENARIOS } from '../lib/trainingProgress';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';

interface InicioModuleProps {
  currentUser: User;
  onStartTraining?: () => void;
}

const YELLOW = 'var(--accent)';
const YELLOW_DARK = 'var(--accent-dark)';
const NAVY_DARK = 'var(--navy)';

export default function InicioModule({ currentUser, onStartTraining }: InicioModuleProps) {
  const { filialAtiva } = useFilial();
  const empresa = FILIAL_META[filialAtiva ?? 'supermax'];
  const now = new Date();
  const hora = now.getHours();
  const saudacao =
    hora < 12 ? 'Bom dia' :
    hora < 18 ? 'Boa tarde' :
    'Boa noite';

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-8" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div className="w-full max-w-5xl">
        {/* Saudação ao operador */}
        <div className="text-center mb-8">
          <div
            className="inline-block px-4 py-1 rounded-full text-[11px] font-black uppercase tracking-[0.35em] border-2"
            style={{ background: YELLOW, color: NAVY_DARK, borderColor: YELLOW_DARK }}
          >
            {now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </div>
          <h1
            className="mt-4 text-4xl md:text-5xl font-black tracking-tight leading-tight"
            style={{ color: NAVY_DARK }}
          >
            {saudacao}, {currentUser.name.split(' ')[0]}!
          </h1>
        </div>

        {/* Um card do MaxPOS (o sistema) e um da EMPRESA ATIVA. O segundo
            era o SuperMax fixo, entao MaxLook e TechMax viam a marca de outra
            loja na propria tela de entrada. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* MaxPOS — o sistema */}
          {/* border-4 -> borda fina + elevacao. Os 4px de contorno vinham de
              quando o sistema inteiro era plano e a borda era o unico recurso
              pra separar superficies; agora que os cards tem sombra, aquele
              traco grosso era o que mais lembrava wireframe na tela de entrada. */}
          <div className="neumorphic p-8 flex flex-col items-center text-center border-t-4"
            style={{ borderTopColor: NAVY_DARK }}
          >
            <div
              className="w-32 h-32 bg-white rounded-xl p-3 border-2 flex items-center justify-center mb-4"
              style={{ borderColor: YELLOW }}
            >
              <img src="/icon-maxpos.png" alt="MaxPOS" className="max-w-full max-h-full object-contain" draggable={false} />
            </div>
            <h2
              className="text-3xl font-black tracking-tight"
              style={{ color: NAVY_DARK, letterSpacing: '-0.02em' }}
            >
              {/* O POS sai no amarelo da logo (var(--accent) = #FFC107 no
                  SuperMax). O dourado escuro que estava aqui e a cor de
                  BORDA do tema, nao a da marca. */}
              Max<span style={{ color: YELLOW }}>POS</span>
            </h2>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: NAVY_DARK, opacity: 0.6 }}>
              ERP · PDV · GESTÃO
            </p>
            <p className="mt-4 text-sm text-gray-600 leading-relaxed">
              {/* Dizia "...financeiro e relatórios". O módulo Relatórios saiu do
                  sistema em 2026-09-04 e o texto virou promessa de uma tela que
                  não existe mais. */}
              Sistema de gestão integrado: PDV, cadastros, estoque,
              financeiro e folha de pagamento.
            </p>
          </div>

          {/* Empresa ativa */}
          {/* Faixa no acento do tema, nao em `empresa.dark`: no SuperMax o dark
              e o azul da logo e o card saia azul, destoando do amarelo que
              identifica o sistema. */}
          <div className="neumorphic p-8 flex flex-col items-center text-center border-t-4"
            style={{ borderTopColor: YELLOW }}
          >
            {/* A placa acompanha o fundo embutido no PNG de cada logo, e a
                moldura fina fica na cor da EMPRESA (azul no SuperMax) — é ela
                que identifica a loja dentro do card. A borda grossa em volta é
                que carrega o amarelo do sistema. */}
            <div
              className="w-32 h-32 rounded-xl p-3 border-2 flex items-center justify-center mb-4 overflow-hidden"
              style={{ background: empresa.plate, borderColor: empresa.color }}
            >
              <img src={empresa.logo} alt={empresa.label} className="max-w-full max-h-full object-contain" draggable={false} />
            </div>
            {/* NAVY_DARK e a cor escura da MARCA (var(--navy)), que o tema
                troca por empresa: azul no SuperMax, preto no MaxLook e no
                TechMax. Antes usava `empresa.dark`, que e o acento escuro —
                laranja queimado no TechMax, marrom no MaxLook — e o nome da
                loja saía colorido em vez de preto. */}
            <h2
              className="text-3xl font-black tracking-tight"
              style={{ color: NAVY_DARK, letterSpacing: '-0.02em' }}
            >
              {empresa.label}
            </h2>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: NAVY_DARK, opacity: 0.65 }}>
              {empresa.descricao}
            </p>
            <p className="mt-4 text-sm text-gray-600 leading-relaxed">
              Você está operando nesta empresa. Produtos, caixa, estoque e
              resultado são próprios dela — troque pelo botão no topo.
            </p>
          </div>
        </div>

        {/* Modo Treinamento — discreto, embaixo dos cards */}
        {onStartTraining && (() => {
          const completed = getCompleted(currentUser.id);
          const isNew = completed.size === 0;
          const isDone = completed.size >= ALL_SCENARIOS.length;
          const label = isDone
            ? 'Praticar Novamente'
            : isNew
              ? 'Fazer 1º Treinamento'
              : `Continuar Treinamento (${completed.size}/${ALL_SCENARIOS.length})`;
          // Unica acao da tela inteira, e estava desenhada como botao
          // secundario — contorno fino sobre fundo branco, no meio de dois
          // cards grandes que nao fazem nada. Agora e o que parece ser: a
          // porta de entrada do treino.
          return (
            <div className="mt-8 flex flex-col items-center gap-2">
              <button
                onClick={onStartTraining}
                className="px-7 py-3.5 rounded-lg border-2 flex items-center gap-2.5 text-sm font-black uppercase tracking-wider transition hover:brightness-105 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-yellow-400"
                style={{ borderColor: YELLOW_DARK, color: 'var(--accent-fg)', background: YELLOW, boxShadow: 'var(--shadow-raised)' }}
                title="Abrir o PDV em modo de treinamento — nada é salvo no banco"
              >
                <span className="text-lg">🎓</span>
                {label}
                {isNew && (
                  <span
                    className="ml-1 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full"
                    style={{ background: '#b91c1c', color: 'white' }}
                  >
                    NOVO
                  </span>
                )}
                {isDone && (
                  <span
                    className="ml-1 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full"
                    style={{ background: '#15803d', color: 'white' }}
                  >
                    ✓ COMPLETO
                  </span>
                )}
              </button>
            </div>
          );
        })()}

        {/* Os dois chips do rodape sairam.
            "OPERADOR: FULANO" repetia, em caixa alta e com moldura, o nome que
            o cabecalho ja mostra a dois palmos dali.
            O relogio era pior: `now` e calculado UMA vez, na renderizacao, e
            nunca mais. Ficava parado na hora em que a tela abriu — marcava
            16:34 quando ja eram 16:36. Relogio que mente e pior do que a
            ausencia de relogio, e a data do dia ja esta no topo da tela. */}
      </div>
    </div>
  );
}
