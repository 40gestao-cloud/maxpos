/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, ChevronRight, Search, Edit2, Trash2, UserPlus, Shield, User as UserIcon, Mail, Lock, Barcode, Download, X as CloseIcon, Printer, Package, Upload, FileText, FileSpreadsheet, FolderTree, Eye, EyeOff, ExternalLink, CreditCard, Phone, MapPin, ClipboardPaste, Tag, CircleDollarSign, Boxes, ListChecks, Image as ImageIcon, ChevronDown } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Client, User, UserRole, Category } from '../types';
import { Storage } from '../lib/storage';
import { assinarTabelas, semRemovidos, mesclarAlterados, porNome, type Mudancas } from '../lib/realtime';
import { maskCPF, maskCNPJ, maskRG, maskPhone, maskCellphone, maskCEP, maskCurrency, parseCurrencyToNumber, formatBRL, isValidCpfCnpj } from '../lib/masks';
import { useAlertDialog, useConfirmDialog } from './ConfirmDialog';
import { explicarErro } from '../lib/erros';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { CAMPO, Obrigatorio, CabecalhoForm, RodapeForm, Segmentado, Dado } from './FormCadastro';
import { AvatarCadastro } from './AvatarCadastro';
import { useToast } from './Toast';
import { ATRIBUTOS_PRODUTO, atributosPadrao } from '../lib/atributosProduto';
import { formatarEnderecoLinha, formatarCEP, parseEnderecoColado, ROTULO_ENDERECO, type EnderecoCampos } from '../lib/endereco';
import { comprimirImagemParaTeto, tamanhoDataUrl, IMAGEM_MAX_ENTRADA_BYTES, IMAGEM_MAX_ENTRADA_LABEL } from '../lib/imageResize';
import { LIMITE_VITRINE } from './VitrineModule';
import { ColarImagem } from './ColarImagem';

type SubCadastro = 'categorias' | 'produtos' | 'servicos' | 'clientes' | 'fornecedores' | 'equipe';

// Teto do arquivo de foto de produto. Desde o patch 2026-09-18b ela vai para o
// Storage (a coluna `image` guarda só a URL), mas comprimir continua valendo:
// é o que cada PDV e a Vitrine baixam. O arquivo que o usuário escolhe pode ser
// muito maior: o navegador reduz até caber aqui.
const IMAGEM_PRODUTO_MAX_BYTES = 120 * 1024;

// MaxID — app irmão que gera CPF, CNPJ e celular de treino com dígito
// verificador válido. O aluno precisa de documento para cadastrar cliente e
// fornecedor, e inventar número na mão produz cadastro que a validação recusa
// (e ensina que documento é enfeite). Mesmo botão do LogMax, para que quem
// treina nos dois sistemas encontre a ferramenta no mesmo lugar.
const MAXID_URL = 'https://max-id.vercel.app';

// Colar o endereço do MaxID em vez de redigitar.
//
// O MaxID entrega o endereço numa linha só ("Rua das Flores, 123 — Centro,
// São Paulo/SP — CEP 01234-567") e o aluno tinha que quebrar isso à mão em
// seis campos. Seis campos redigitados é onde o CEP some e a UF vem errada.
// Aqui ele cola e os campos se preenchem; o que o parser não reconhecer
// continua editável na mão, e a tela DIZ o que preencheu — preenchimento
// silencioso é pior que nenhum, porque ninguém confere o que não viu.
function ColarEnderecoMaxID({ onPreencher }: { onPreencher: (campos: EnderecoCampos) => void }) {
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const aplicar = (valor: string) => {
    const campos = parseEnderecoColado(valor);
    const nomes = (Object.keys(campos) as (keyof EnderecoCampos)[]);
    if (!nomes.length) {
      setOk(null);
      setAviso('Não reconheci nenhum campo aí. Cole a linha inteira que o MaxID gerou, no formato "Rua, 123 — Bairro, Cidade/UF — CEP 00000-000".');
      return;
    }
    onPreencher(campos);
    setTexto('');
    setAviso(null);
    setOk(`Preenchido: ${nomes.map(n => ROTULO_ENDERECO[n]).join(', ')}.`);
  };

  return (
    <div className="mb-5 space-y-1.5">
      <label className="fc-label flex items-center gap-1.5">
        <ClipboardPaste size={14} /> Colar endereço do MaxID
      </label>
      <div className="flex gap-2">
        <input
          value={texto}
          onChange={e => { setTexto(e.target.value); setAviso(null); setOk(null); }}
          // Colar já preenche: obrigar a um segundo clique depois do Ctrl+V
          // seria pedir uma etapa que o próprio gesto já deixou clara.
          onPaste={e => {
            const colado = e.clipboardData.getData('text');
            if (colado.trim()) { e.preventDefault(); setTexto(colado); aplicar(colado); }
          }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aplicar(texto); } }}
          className={`${CAMPO} flex-1 min-w-0`}
          placeholder="Rua das Flores, 123 — Centro, São Paulo/SP — CEP 01234-567"
        />
        <button type="button" onClick={() => aplicar(texto)} className="smart-btn-secondary !py-2 !px-4 !text-sm shrink-0">
          Preencher
        </button>
      </div>
      {ok && <p className="text-xs font-semibold text-emerald-700">{ok}</p>}
      {aviso && <p className="text-xs font-semibold text-red-600">{aviso}</p>}
      {!ok && !aviso && (
        <p className="fc-hint">Preenche os campos abaixo, que continuam editáveis.</p>
      )}
    </div>
  );
}

// Foto de um cadastro — pessoa (cliente, fornecedor) ou categoria. Mesmo
// tratamento do produto: entra foto grande, o
// navegador reduz. O teto aqui é menor (400 px / 60 KB) porque a imagem
// aparece em 48 px no card, e a lista inteira vem numa query só.
function CampoFoto({
  nome, image, onChange, onErro,
}: {
  nome: string;
  image?: string;
  onChange: (dataUrl: string | undefined) => void;
  onErro: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processando, setProcessando] = useState(false);

  const processar = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      onErro('Formato não suportado. Use JPG, PNG ou WEBP.');
      return;
    }
    setProcessando(true);
    try {
      onChange(await comprimirImagemParaTeto(file, { maxLado: 400, maxBytes: 60 * 1024 }));
    } catch (err: any) {
      onErro(err?.message || 'Não foi possível processar a imagem.');
    } finally {
      setProcessando(false);
    }
  };

  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processar(file);
  };

  return (
    <div className="flex items-center gap-4">
      {/* Anel no acento: sem ele o avatar "?" (cor do nome, escura) sumia no
          fundo azul do formulário. */}
      <div className="rounded-xl ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-transparent shrink-0">
        <AvatarCadastro nome={nome || '?'} image={image} size={72} />
      </div>
      <div className="space-y-1.5">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={escolher} className="hidden" />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={processando}
            className="smart-btn-secondary !py-1.5 !px-3 !text-sm disabled:opacity-60 disabled:cursor-wait"
          >
            <Upload size={14} /> {processando ? 'Otimizando…' : image ? 'Trocar foto' : 'Escolher foto'}
          </button>
          <ColarImagem onImagem={processar} disabled={processando} />
          {image && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="smart-btn-danger !py-1.5 !px-3 !text-sm inline-flex items-center gap-1.5"
            >
              <CloseIcon size={14} /> Remover
            </button>
          )}
        </div>
        <p className="fc-hint">
          Opcional — sem foto, o card usa as iniciais. Aceita até {IMAGEM_MAX_ENTRADA_LABEL}; o sistema reduz sozinho.
        </p>
      </div>
    </div>
  );
}

interface CardPessoaProps {
  item: any;
  /** Cliente mostra status e limite de crédito; fornecedor mostra o contato. */
  kind: 'cliente' | 'fornecedor';
  podeExcluir: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
}

// Card de pessoa, no lugar da linha de tabela.
//
// A tabela dava cinco colunas a um cadastro que tem quinze campos: nome, tipo,
// documento, telefone e status. Endereço, e-mail secundário, IE e limite de
// crédito só apareciam abrindo o registro. E, como toda linha tem a mesma
// altura, trinta clientes viravam trinta faixas idênticas — o mesmo problema
// que o LogMax resolveu com card, e é o formato que este módulo agora espelha.
function CardPessoa({ item, kind, podeExcluir, onEdit, onDelete, onView }: CardPessoaProps) {
  const ehPJ = item.type === 'PJ';
  const docLabel = ehPJ ? 'CNPJ' : 'CPF';
  const endereco = formatarEnderecoLinha(item);
  const fone = item.phone || item.cellphone;
  const ativo = item.status !== 'inactive';

  return (
    <div className="neumorphic p-5 rounded-2xl flex flex-col gap-4 group">
      <div className="flex justify-between items-start gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <AvatarCadastro nome={item.name} image={item.image} />
          <div className="min-w-0">
            {/* Duas linhas em vez de truncar: "FISIA Comércio de Produtos
                Esportivos" não cabe em 240px e virava "FISIA Comércio ...".
                Numa linha de tabela cortar é o preço da densidade; num card
                sobra altura, e razão social cortada não identifica ninguém. */}
            <h3 className="font-black text-gray-900 leading-tight line-clamp-2 break-words">{item.name}</h3>
            {item.tradeName && (
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wide truncate">{item.tradeName}</div>
            )}
            <div className="flex gap-1.5 items-center flex-wrap mt-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                {ehPJ ? 'Pessoa Jurídica' : 'Pessoa Física'}
              </span>
              {kind === 'cliente' && (
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${
                  ativo ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
                }`}>
                  {ativo ? 'Ativo' : 'Inativo'}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* No toque não existe hover: escondidas só a partir de md, senão as
            ações ficariam inalcançáveis no tablet, que é onde a turma usa. */}
        {/* Sempre visiveis. Escondidas ate o hover, elas simplesmente NAO
            EXISTIAM para quem usa tablet — e sumir e desaparecer sao a mesma
            coisa para quem nunca passou o mouse ali. */}
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit} className="row-action-btn is-editar" title="Editar">
            <Edit2 size={16} />
          </button>
          {podeExcluir && (
            <button onClick={onDelete} className="row-action-btn is-excluir" title="Excluir">
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={onView} className="row-action-btn is-detalhes" title="Detalhes">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="neumorphic-inset rounded-xl p-3.5 flex flex-col gap-2 text-sm">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black border-b border-gray-300/60 pb-1.5">
          Contato
        </span>
        {item.document ? (
          <div className="flex items-center gap-2 text-gray-700 min-w-0">
            <CreditCard size={13} className="text-gray-400 shrink-0" />
            <span className="font-mono text-xs truncate">{docLabel} {item.document}</span>
          </div>
        ) : null}
        {fone ? (
          <div className="flex items-center gap-2 text-gray-700 min-w-0">
            <Phone size={13} className="text-gray-400 shrink-0" />
            <span className="text-xs truncate">{fone}</span>
          </div>
        ) : null}
        {item.email ? (
          <div className="flex items-center gap-2 text-gray-700 min-w-0">
            <Mail size={13} className="text-gray-400 shrink-0" />
            <span className="text-xs truncate">{item.email}</span>
          </div>
        ) : null}
        {endereco ? (
          <div className="flex items-start gap-2 text-gray-600 min-w-0">
            <MapPin size={13} className="text-gray-400 shrink-0 mt-0.5" />
            <span className="text-xs leading-relaxed">{endereco}</span>
          </div>
        ) : null}
        {!item.document && !fone && !item.email && !endereco && (
          <span className="text-xs text-gray-400 italic">Sem informações de contato</span>
        )}
      </div>

      {/* Rodapé: o dado que era exclusivo de cada tipo e que a tabela escondia
          — limite de crédito do cliente, pessoa de contato do fornecedor. */}
      {kind === 'cliente' ? (
        <div className="flex justify-between items-center text-xs pt-1 mt-auto border-t border-gray-200 pt-3">
          <span className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Limite de crédito</span>
          <strong className="text-[var(--navy)] tabular-nums">{formatBRL(item.creditLimit || 0)}</strong>
        </div>
      ) : (
        // "Contato" aqui e "Contato" no cabeçalho do painel acima eram a mesma
        // palavra para coisas diferentes no MESMO card — o painel é o meio de
        // contato, isto é a PESSOA com quem se fala.
        <div className="flex justify-between items-center text-xs mt-auto border-t border-gray-200 pt-3 gap-2">
          <span className="text-gray-500 font-bold uppercase tracking-widest text-[10px] shrink-0">Pessoa de contato</span>
          <strong className="text-[var(--navy)] truncate">{item.contact || '—'}</strong>
        </div>
      )}
    </div>
  );
}

/** Botão do MaxID no alto do formulário — vale para as três empresas, já que
 *  documento e celular não mudam de regra entre SuperMax, MaxLook e TechMax. */
function BotaoMaxID({ pj }: { pj: boolean }) {
  return (
    <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
      <button
        type="button"
        onClick={() => window.open(MAXID_URL, '_blank', 'noopener,noreferrer')}
        className="smart-btn-secondary !py-1 !pl-1 !pr-3 !text-sm"
      >
        {/* O PNG tem fundo preto próprio, daí o canto arredondado em vez de
            tentar dissolvê-lo no fundo claro do tema. */}
        <img src="/icon-maxid.png" alt="" className="h-7 w-auto rounded-md" />
        Gerar no MaxID <ExternalLink size={13} />
      </button>
      {/* Dizer o que o botão faz vale mais que o tooltip: em tablet não há
          hover, e é justamente ali que a turma preenche. */}
      <p className="fc-hint sm:text-right">
        Gera {pj ? 'CNPJ' : 'CPF'} e celular em outra aba; o que já foi digitado fica aqui.
      </p>
    </div>
  );
}


interface CadastrosModuleProps {
  currentUser: User;
  /** Qual cadastro exibir. Vem da ROTA (submenu da sidebar), não de aba
   *  interna: com abas dentro da view, trocar de cadastro não mudava onde o
   *  operador estava, e o topo acumulava abas + filtro + busca + exportar. */
  subTab: SubCadastro;
}

export default function CadastrosModule({ currentUser, subTab }: CadastrosModuleProps) {
  const { showAlert, host: alertHost } = useAlertDialog();
  const toast = useToast();
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);


  // Formulário de categoria (inline na própria lista — é cadastro de 3 campos,
  // modal seria peso demais pra isso).
  const [catForm, setCatForm] = useState<Category | null>(null);
  const [catSaving, setCatSaving] = useState(false);
  const [search, setSearch] = useState('');
  // '' = todas. Só vale na lista de produtos.
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  // Filtro de nicho (só relevante em produtos/serviços). 'todos' mostra tudo,
  // ou filtra por PDV: SuperMax (supermercado), MaxLook (boutique), TechMax
  // (eletrônicos/assistência). Coluna pdv_mode adicionada em 2026-07-20.
  // A empresa nao e mais escolhida aqui: e a da sessao (header). Enquanto era
  // um filtro local, dava pra cadastrar produto numa loja estando "em" outra.
  const { filialAtiva } = useFilial();
  const nichoFilter = filialAtiva ?? 'supermax';
  // A categoria escolhida é de UMA empresa: ao trocar, o seletor não teria a
  // opção e a lista ficaria vazia sem motivo aparente.
  useEffect(() => { setCategoriaFiltro(''); }, [nichoFilter]);
  // Badge sólido de empresa. A paleta mora no FilialContext (FILIAL_META) —
  // estava duplicada aqui, no FiltroLoja e no PDV, e as três já tinham
  // divergido: SuperMax chegou a ser amarelo num lugar e azul no outro.
  // FilialBadge saiu das listas (2026-09-04). Toda lista desta tela filtra por
  // `pdvMode === nichoFilter`, e `nichoFilter` E a empresa da sessao — entao o
  // selo mostrava a MESMA empresa em todas as linhas, por construcao. Eram 59
  // etiquetas azuis repetindo o que o botao de empresa no topo ja diz, cada uma
  // disputando atencao com o nome do produto ao lado. Se um dia alguma lista
  // passar a misturar empresas, o selo volta — mas por linha DIVERGENTE.
  const [, _setSessionUser] = useState<User | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [viewingDetails, setViewingDetails] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});

  // Markup-alvo da categoria escolhida no produto, e o preço que ele sugere a
  // partir do custo. `null` quando não há categoria, quando ela não tem alvo ou
  // quando ainda não há custo — e aí nada é sugerido, que é o certo: sugerir
  // preço sem custo seria inventar número.
  const markupAlvoDaCategoria = useMemo(
    () => categories.find(c => c.name === formData.category)?.markupAlvo ?? null,
    [categories, formData.category],
  );

  const precoSugerido = useMemo(() => {
    const custo = Number(formData.costPrice || 0);
    if (markupAlvoDaCategoria == null || custo <= 0) return null;
    return Math.round(custo * (1 + markupAlvoDaCategoria / 100) * 100) / 100;
  }, [markupAlvoDaCategoria, formData.costPrice]);
  // Campos da ficha por nicho em modo "Outro…" (livre: true em
  // atributosProduto.ts) — precisa viver fora do valor do campo. Se o modo
  // dependesse só do valor estar vazio, escolher "Outro" e ainda não ter
  // digitado nada faria o select voltar pra "— Selecione —" sozinho.
  const [fichaOutro, setFichaOutro] = useState<Set<string>>(new Set());
  // Rascunho da Margem de Lucro enquanto o campo está focado — null quando
  // não está sendo editada (mostra o valor calculado de price/costPrice).
  // Precisa de buffer próprio: se o valor exibido viesse direto do cálculo,
  // cada tecla recalcularia o preço e o cursor pularia no meio da digitação.
  const [marginDraft, setMarginDraft] = useState<string | null>(null);
  // Markup tem o mesmo problema de digitação da margem, então ganha o mesmo
  // buffer. Os dois campos leem do MESMO par custo/preço: mexer em um reflete
  // no outro assim que o preço muda.
  const [markupDraft, setMarkupDraft] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, id: string, type: string, name: string } | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: '' as UserRole });
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  // Segundo passo da remocao: aparece so quando a empresa atual e a UNICA da
  // pessoa, e a escolha passa a ser entre nada e apagar a conta.
  const [excluirContaConfirm, setExcluirContaConfirm] = useState<{ id: string; name: string } | null>(null);
  // Empresas marcadas no formulario de edicao. So vale para Operador de
  // Caixa: gestao opera nas tres por definicao do cargo.
  const [lojasForm, setLojasForm] = useState<string[]>([]);
  const [barcodeModal, setBarcodeModal] = useState<{ isOpen: boolean, product: any | null }>({ isOpen: false, product: null });
  const [stockModal, setStockModal] = useState<{ isOpen: boolean, product: any | null, action: 'sum' | 'subtract' | 'correct', amount: number }>({ isOpen: false, product: null, action: 'sum', amount: 0 });
  const barcodeRef = useRef<SVGSVGElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [eanInput, setEanInput] = useState('');
  const [savingEan, setSavingEan] = useState(false);

  const [processandoImagem, setProcessandoImagem] = useState(false);

  const handleProductImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-upload do mesmo arquivo
    if (file) processarImagemProduto(file);
  };

  // Upload e Ctrl+V caem aqui: a imagem colada passa pela mesma redução.
  const processarImagemProduto = async (file: File) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showAlert('Formato não suportado. Use JPG, PNG ou WEBP.');
      return;
    }

    if (file.size > IMAGEM_MAX_ENTRADA_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      showAlert(`Imagem com ${mb} MB — máximo ${IMAGEM_MAX_ENTRADA_LABEL}.`);
      return;
    }

    setProcessandoImagem(true);
    try {
      const dataUrl = await comprimirImagemParaTeto(file, {
        // 900 px cobre o card da Vitrine com folga; acima disso é peso que
        // ninguém enxerga numa miniatura de 48 px na tabela.
        maxLado: 900,
        maxBytes: IMAGEM_PRODUTO_MAX_BYTES,
      });
      setFormData((prev: any) => ({ ...prev, image: dataUrl }));
      const kbOrigem = Math.round(file.size / 1024);
      const kbFinal = Math.round(tamanhoDataUrl(dataUrl) / 1024);
      if (kbFinal < kbOrigem) {
        toast.sucesso({ titulo: `Imagem otimizada: ${kbOrigem} KB → ${kbFinal} KB` });
      }
    } catch (err: any) {
      showAlert(err?.message || 'Erro ao processar a imagem.');
    } finally {
      setProcessandoImagem(false);
    }
  };

  // ---------- EAN-13 helpers ----------
  const isValidEAN13 = (code: string): boolean => {
    if (!/^\d{13}$/.test(code)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return parseInt(code[12]) === (10 - (sum % 10)) % 10;
  };

  const generateEAN13 = (): string => {
    let digits = '789'; // prefixo Brasil (uso interno é OK)
    for (let i = 0; i < 9; i++) digits += Math.floor(Math.random() * 10).toString();
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * (i % 2 === 0 ? 1 : 3);
    return digits + ((10 - (sum % 10)) % 10).toString();
  };

  const eanValid = isValidEAN13(eanInput);
  const eanDirty = barcodeModal.product && eanInput !== (barcodeModal.product.ean13 || '');

  // Reset eanInput sempre que abre o modal
  useEffect(() => {
    if (barcodeModal.isOpen) {
      setEanInput(barcodeModal.product?.ean13 || '');
    } else {
      setEanInput('');
      setSavingEan(false);
    }
  }, [barcodeModal.isOpen, barcodeModal.product]);

  // Renderiza/atualiza o barcode SVG quando EAN muda
  useEffect(() => {
    if (!barcodeModal.isOpen || !barcodeRef.current) return;
    // Limpa primeiro (caso EAN inválido)
    barcodeRef.current.innerHTML = '';
    if (!eanValid) return;
    try {
      JsBarcode(barcodeRef.current, eanInput, {
        format: 'EAN13',
        flat: true,
        width: 2,
        height: 100,
        displayValue: true,
        fontOptions: 'bold',
        fontSize: 20,
        background: 'white',
        lineColor: '#000000',
      });
    } catch (e) {
      console.error('Erro ao gerar barcode:', e);
    }
  }, [eanInput, eanValid, barcodeModal.isOpen]);

  const saveEanToProduct = async () => {
    if (!eanValid || !barcodeModal.product) return;
    setSavingEan(true);
    try {
      const updated = { ...barcodeModal.product, ean13: eanInput };
      await Storage.atualizarEanProduto(updated.id, eanInput);
      setBarcodeModal({ isOpen: true, product: updated });
      // Sem isto o banco tinha o EAN novo e a tabela continuava mostrando o
      // produto sem código até o F5 — o operador salvava e parecia não ter
      // salvado. Mescla só o EAN: o resto da linha pode ser mais novo que o
      // produto que o modal guardou ao abrir.
      setProducts(prev => prev.map(p => p.id === updated.id ? { ...p, ean13: eanInput } : p));
      toast.sucesso({
        titulo: `EAN gravado em ${updated.name}`,
        mensagem: `${eanInput} — já pode imprimir a etiqueta e bipar no PDV.`,
      });
    } catch (err: any) {
      showAlert(explicarErro(err, 'gravar o código de barras'));
    } finally {
      setSavingEan(false);
    }
  };

  const downloadBarcode = () => {
    if (!barcodeRef.current) return;
    const svgData = new XMLSerializer().serializeToString(barcodeRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width + 40;
      canvas.height = img.height + 100;
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "black";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        
        if (barcodeModal.product) {
          ctx.fillText(barcodeModal.product.name.toUpperCase(), canvas.width / 2, 40);
        }
        
        ctx.drawImage(img, 20, 60);
        
        const pngFile = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.download = `etiqueta-${eanInput || barcodeModal.product?.ean13 || 'ean'}.png`;
        downloadLink.href = pngFile;
        downloadLink.click();
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const downloadPDF = () => {
    if (!barcodeRef.current) return;
    const svgData = new XMLSerializer().serializeToString(barcodeRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width + 100;
      canvas.height = img.height + 150;
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "black";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        if (barcodeModal.product) {
          ctx.fillText(barcodeModal.product.name.toUpperCase(), canvas.width / 2, 50);
        }
        ctx.drawImage(img, 50, 80);
        
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'px',
          format: [canvas.width, canvas.height]
        });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`etiqueta-${eanInput || barcodeModal.product?.ean13 || 'ean'}.pdf`);
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const printLabel = () => {
    if (!barcodeRef.current) return;
    const svgData = new XMLSerializer().serializeToString(barcodeRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width + 100;
      canvas.height = img.height + 150;
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "black";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        if (barcodeModal.product) {
          ctx.fillText(barcodeModal.product.name.toUpperCase(), canvas.width / 2, 50);
        }
        ctx.drawImage(img, 50, 80);
        
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'px',
          format: [canvas.width, canvas.height]
        });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        const pdfBlob = pdf.output('bloburl');
        const printWindow = window.open(pdfBlob.toString());
        if (printWindow) {
          printWindow.print();
        }
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  // Trocar de submenu limpa o que era daquele cadastro. Com aba interna isso
  // acontecia no onClick; agora quem troca e a ROTA, entao mora aqui — senao
  // o formulario de produto continuaria aberto ao cair em Clientes.
  useEffect(() => {
    setShowAddUser(false);
    setShowAddProduct(false);
    setShowAddClient(false);
    setShowAddService(false);
    setShowAddSupplier(false);
    setEditingItem(null);
    setFormData({});
    setCatForm(null);
    setSearch('');
    // Estes o remount limpava sozinho: a sub-aba fazia parte da `key` do
    // conteúdo (App.tsx). Agora o módulo sobrevive à troca, e um detalhe ou
    // uma confirmação de exclusão abertos em Produtos não podem aparecer em
    // Clientes apontando para um produto.
    setViewingDetails(null);
    setDeleteConfirm(null);
    setExcluirContaConfirm(null);
    setBarcodeModal({ isOpen: false, product: null });
    setStockModal({ isOpen: false, product: null, action: 'sum', amount: 0 });
    setMarginDraft(null);
    setMarkupDraft(null);
  }, [subTab]);

  useEffect(() => {
    _setSessionUser(currentUser);
    let active = true;
    // Produto carrega só da empresa ativa: `getProducts()` sem argumento
    // trazia o catálogo das TRÊS lojas inteiro — nome, preço E a imagem em
    // base64 (até 120 KB cada) — toda vez que o operador entrava em
    // Cadastros, mesmo estando em uma tela que só usa uma delas. Com ~100+
    // produtos na TechMax isso é vários MB trafegados e parseados à toa a
    // cada visita, e é o que fazia o módulo abrir com lentidão perceptível.
    // allSettled, nao all: com `Promise.all` + `.catch(() => {})` UMA consulta
    // que falhasse rejeitava o conjunto e nenhuma lista era preenchida — a tela
    // inteira aparecia vazia, sem erro nenhum, como se o banco nao tivesse
    // dado. Foi exatamente o que aconteceu quando `getUsers` quebrou: a Equipe
    // ficou em branco e parecia que os usuarios tinham sumido do banco.
    //
    // Agora cada consulta responde por si: o que deu certo aparece, e o que
    // falhou diz o que falhou em vez de virar silencio.
    const load = async () => {
      const [c, p, s, sv, u, cat] = await Promise.allSettled([
        Storage.getClients(nichoFilter),
        Storage.getProducts(nichoFilter),
        Storage.getSuppliers(nichoFilter),
        Storage.getServices(nichoFilter),
        Storage.getUsers(nichoFilter),
        Storage.getCategories(nichoFilter),
      ]);
      if (!active) return;

      if (c.status === 'fulfilled')   setClients(c.value);
      if (p.status === 'fulfilled')   setProducts(p.value);
      if (s.status === 'fulfilled')   setSuppliers(s.value);
      if (sv.status === 'fulfilled')  setServices(sv.value);
      if (u.status === 'fulfilled')   setUsers(u.value);
      if (cat.status === 'fulfilled') setCategories(cat.value);

      const falhas = [
        ['Clientes', c], ['Produtos', p], ['Fornecedores', s],
        ['Serviços', sv], ['Usuários', u], ['Categorias', cat],
      ].filter(([, r]) => (r as PromiseSettledResult<unknown>).status === 'rejected');

      if (falhas.length > 0) {
        const detalhe = falhas
          .map(([nome, r]) => `${nome}: ${(r as PromiseRejectedResult).reason?.message ?? 'falha'}`)
          .join(' · ');
        showAlert(`Não foi possível carregar: ${detalhe}`);
      }
      setLoading(false);
    };

    load();

    // Realtime: cada tabela recarrega SÓ a si mesma, e só com evento da
    // empresa da sessão. Antes, qualquer evento em qualquer das cinco tabelas
    // chamava `load` — as seis consultas, fotos incluídas —, e uma venda de 3
    // itens em QUALQUER loja fazia isso 3-4 vezes (ver lib/realtime).
    const escopo = `pdv_mode=eq.${nichoFilter}`;
    const recarregarTabela = <T,>(buscar: () => Promise<T[]>, definir: (f: (prev: T[]) => T[]) => void) =>
      async ({ alterados, removidos }: Mudancas) => {
        if (removidos.size) definir(semRemovidos(removidos) as any);
        if (!alterados.size) return;
        const lista = await buscar();
        if (active) definir(() => lista);
      };

    const cancelar = assinarTabelas('cadastros-rt', [
      {
        // Produto é o que mais muda (baixa de estoque a cada item vendido) e o
        // mais caro de recarregar (fotos). Busca só as linhas tocadas e troca
        // no lugar.
        tabela: 'products',
        filtro: escopo,
        aoMudar: async ({ alterados, removidos }) => {
          if (removidos.size) setProducts(semRemovidos(removidos));
          if (!alterados.size) return;
          const linhas = await Storage.getProductsByIds([...alterados], nichoFilter);
          if (!active) return;
          setProducts(prev => mesclarAlterados(prev, linhas, alterados, porNome));
        },
      },
      { tabela: 'clients',   filtro: escopo, aoMudar: recarregarTabela(() => Storage.getClients(nichoFilter), setClients) },
      { tabela: 'suppliers', filtro: escopo, aoMudar: recarregarTabela(() => Storage.getSuppliers(nichoFilter), setSuppliers) },
      { tabela: 'services',  filtro: escopo, aoMudar: recarregarTabela(() => Storage.getServices(nichoFilter), setServices) },
      // `user_profiles` não tem pdv_mode (a empresa mora no array `lojas`, e o
      // Realtime não filtra por "contém"). Fica sem filtro — a tabela quase
      // não muda e não participa de venda.
      { tabela: 'user_profiles', aoMudar: recarregarTabela(() => Storage.getUsers(nichoFilter), setUsers) },
    ], {
      // Ver lib/realtime: evento perdido durante um corte não volta. Aqui são
      // seis listas, e uma delas parada é um produto que some do cadastro sem
      // motivo aparente.
      aoRessincronizar: load,
    });

    return () => { active = false; cancelar(); };
  }, []);

  const [users, setUsers] = useState<User[]>([]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.role) return showAlert('Selecione um cargo');
    if (editingItem && newUser.role === 'operador_caixa' && lojasForm.length === 0) {
      // Sem empresa nenhuma o usuario some de todas as listas e nao entra em
      // lugar nenhum. Para tirar o acesso, o caminho e excluir a conta.
      return showAlert('Marque pelo menos uma empresa para o Operador de Caixa.');
    }

    if (editingItem) {
      try {
        await Storage.updateUserProfile(editingItem.id, { name: newUser.name, role: newUser.role as UserRole });

        // Empresas: so para Operador. Gestao recebe as tres do trigger, e
        // mexer aqui seria brigar com ele.
        let lojasFinais: string[] = (editingItem.lojas ?? []) as string[];
        if (newUser.role === 'operador_caixa') {
          const antes = new Set<string>((editingItem.lojas ?? []) as string[]);
          const agora = new Set<string>(lojasForm);
          // Adiciona antes de remover: passar por zero empresas faria a RPC
          // recusar, e o usuario ficaria sem nenhuma no meio do caminho.
          for (const l of agora) {
            if (!antes.has(l)) await Storage.adicionarUsuarioNaEmpresa(editingItem.id, l);
          }
          for (const l of antes) {
            if (!agora.has(l)) await Storage.removerUsuarioDaEmpresa(editingItem.id, l);
          }
          lojasFinais = [...agora];
        }

        const updatedUsers = users.map(u => u.id === editingItem.id
          ? { ...u, name: newUser.name, role: newUser.role as UserRole, lojas: lojasFinais }
          : u);
        // Sai da lista se deixou de operar na empresa aberta.
        setUsers(updatedUsers.filter(u => (u.lojas ?? []).includes(nichoFilter)));
        toast.sucesso({ titulo: `${newUser.name} atualizado` });
      } catch (err: any) {
        showAlert(explicarErro(err, 'atualizar o membro da equipe'));
      }
    } else {
      if (!newUser.password) return showAlert('Defina uma senha temporária');
      try {
        const created = await Storage.createUser(
          newUser.email,
          newUser.password,
          newUser.name,
          newUser.role,
          currentUser?.id,
          // A empresa do novo usuario e a que esta aberta na tela.
          filialAtiva ?? 'supermax',
        );
        setUsers(prev => [...prev, created]);
        // Toast, nao modal: cadastrar cinco pessoas seguidas exigia cinco
        // cliques em OK no meio da tela. Sucesso avisa, nao interrompe.
        toast.sucesso({
          titulo: `${created.name} cadastrado`,
          mensagem: (
            <>
              Entra com <b>{created.email}</b> e a senha definida agora
              {' '}— e já cai direto na {FILIAL_META[nichoFilter].label}.
            </>
          ),
        });
      } catch (err: any) {
        // "ja registrado" e a mensagem crua do Auth e ela confunde: o e-mail e
        // unico em TODAS as empresas, entao a pessoa pode existir em outra
        // loja e nao aparecer nesta lista, que e filtrada pela empresa ativa.
        // Sem esta traducao parece que sobrou um usuario fantasma no banco.
        const jaExiste = /already been registered|already exists|already registered/i.test(err?.message ?? '');
        showAlert(jaExiste
          ? `Este e-mail já está cadastrado no sistema — possivelmente em OUTRA empresa, `
            + `por isso não aparece nesta lista. O e-mail é único entre as três empresas: `
            + `para a mesma pessoa operar em duas, use um e-mail por empresa.`
          : 'Erro ao cadastrar membro: ' + err.message);
      }
    }
    setShowAddUser(false);
    setNewUser({ name: '', email: '', password: '', role: '' as UserRole });
    setSenhaVisivel(false);
    setEditingItem(null);
  };

  // Espelha nivel_cargo()/prevent_role_escalation() do banco. Aqui e so
  // conveniencia de tela — quem decide de verdade e o trigger, que barra
  // mesmo se alguem chamar a API pelo F12.
  const NIVEL: Record<UserRole, number> = {
    admin_master: 100,
    ceo: 80,
    operador_caixa: 20,
  };

  // Só cargos ESTRITAMENTE abaixo do seu. E o que impede a escalada em dois
  // passos: o CEO nao cria outro CEO que depois o promoveria de volta.
  // admin_master nunca aparece: o posto e unico e so muda por transferencia.
  const getAvailableRoles = (role?: UserRole): UserRole[] => {
    if (!role) return [];
    const meu = NIVEL[role] ?? 0;
    return (Object.keys(NIVEL) as UserRole[])
      .filter(r => r !== 'admin_master' && NIVEL[r] < meu)
      .sort((a, b) => NIVEL[b] - NIVEL[a]);
  };

  // Uma linha da lista de Equipe so e editavel por quem esta ACIMA dela — ou
  // pela propria pessoa, que edita nome e avatar (o cargo, nao: o trigger
  // barra mudar o proprio cargo, inclusive o do Admin Master). Espelha a
  // policy `profiles_update_self_or_abaixo`.
  const podeEditarUsuario = (alvo: { id: string; role: UserRole }): boolean =>
    alvo.id === currentUser?.id ||
    (NIVEL[currentUser?.role as UserRole] ?? 0) > (NIVEL[alvo.role] ?? 0);

  // Excluir cadastro e da cupula. Espelha as policies `*_delete_cadastro` /
  // `accounts_delete_financeiro` (patch 2026-09-03_seguranca_parte5), que sao
  // RESTRICTIVE em `meu_nivel() >= 80`.
  //
  // Esconder importa mais aqui do que nos outros botoes: DELETE barrado por RLS
  // nao devolve erro, devolve ZERO LINHAS. O operador clicaria, veria o toast
  // de sucesso e so descobriria no F5 que o produto continua la.
  const podeExcluirCadastro = (NIVEL[currentUser?.role as UserRole] ?? 0) >= 80;

  // Escrever o saldo direto no formulário, sem passar por soma/subtrai/corrige.
  // Só o Admin Master: o CEO continua ajustando pela operação, que deixa claro
  // o que foi somado ou corrigido. Diferente de excluir, aqui a trava é SÓ de
  // tela — a policy de UPDATE em `products` é `auth_all` (qualquer usuário da
  // loja), então isto organiza o fluxo e não é barreira de segurança.
  const podeEditarEstoqueDireto = currentUser?.role === 'admin_master';

  const COR_CARGO: Record<UserRole, string> = {
    admin_master: 'bg-[var(--navy)] text-white',
    ceo: 'bg-amber-100 text-amber-900',
    operador_caixa: 'bg-sky-100 text-sky-900',
  };

  const ROLE_LABELS: Record<UserRole, string> = {
    admin_master: 'Admin Master',
    ceo: 'CEO',
    operador_caixa: 'Operador de Caixa',
  };

  const availableRoles = getAvailableRoles(currentUser?.role);

  const filteredClients = clients.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.document || '').includes(search)
  );

  const filteredProducts = products.filter(p => {
    if ((p.pdvMode ?? 'supermax') !== nichoFilter) return false;
    if (categoriaFiltro && (p.category || '') !== categoriaFiltro) return false;
    const q = search.toLowerCase();
    return (p.name?.toLowerCase() || '').includes(q) ||
      (p.ean13 || '').includes(search) ||
      (p.id || '').toLowerCase().includes(q) ||
      (p.category?.toLowerCase() || '').includes(q);
  });

  const exportProductsPDF = () => {
    if (filteredProducts.length === 0) {
      showAlert('Nenhum produto para exportar.');
      return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const now = new Date();
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('MAXPOS — Catálogo de Produtos', 14, 14);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Gerado em ${now.toLocaleString('pt-BR')}  •  ${filteredProducts.length} produto(s)`, 14, 20);

    const rows = filteredProducts.map((p, i) => {
      const margem = p.price && p.costPrice ? (((p.price - p.costPrice) / p.price) * 100) : 0;
      return [
        String(i + 1).padStart(3, '0'),
        p.name || '—',
        p.category || '—',
        p.ean13 || '—',
        formatBRL(p.costPrice || 0),
        formatBRL(p.price || 0),
        `${margem.toFixed(1)}%`,
        p.controlStock === false ? 'Sem Controle' : `${p.stock || 0} ${p.unit || 'un'}`,
      ];
    });

    autoTable(doc, {
      startY: 26,
      head: [['#', 'Produto', 'Categoria', 'EAN-13', 'Custo', 'Venda', 'Margem', 'Estoque']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [23, 37, 84], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 12, halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });

    // ─── Paginas de etiquetas (EAN-13 + descricao) ──────────────
    const productsWithEAN = filteredProducts.filter(p => isValidEAN13(p.ean13 || ''));
    if (productsWithEAN.length > 0) {
      const COLS = 3;
      const ROWS_PER_PAGE = 8;
      const PER_PAGE = COLS * ROWS_PER_PAGE;
      const PAGE_W = 210; // A4 portrait
      const MARGIN_X = 8;
      const HEADER_H = 18;
      const LABEL_W = (PAGE_W - MARGIN_X * 2) / COLS;
      const LABEL_H = 33;

      const drawLabelsHeader = (pageNum: number, totalPages: number) => {
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(23, 37, 84);
        doc.text('MAXPOS — Etiquetas de Produtos', MARGIN_X, 11);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        doc.text(
          `${productsWithEAN.length} etiqueta(s)  •  Pagina ${pageNum} de ${totalPages}  •  Gerado em ${now.toLocaleString('pt-BR')}`,
          MARGIN_X,
          15.5
        );
        doc.setTextColor(0);
      };

      const totalLabelPages = Math.ceil(productsWithEAN.length / PER_PAGE);

      productsWithEAN.forEach((p, idx) => {
        const indexOnPage = idx % PER_PAGE;
        if (indexOnPage === 0) {
          doc.addPage('a4', 'portrait');
          drawLabelsHeader(Math.floor(idx / PER_PAGE) + 1, totalLabelPages);
        }
        const row = Math.floor(indexOnPage / COLS);
        const col = indexOnPage % COLS;
        const x = MARGIN_X + col * LABEL_W;
        const y = HEADER_H + row * LABEL_H;

        // Borda da etiqueta
        doc.setDrawColor(200);
        doc.setLineWidth(0.2);
        doc.rect(x + 1, y + 1, LABEL_W - 2, LABEL_H - 2);

        // Descricao (ate 2 linhas, centralizada)
        const desc = (p.name || '—').toUpperCase();
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        const splitDesc: string[] = doc.splitTextToSize(desc, LABEL_W - 6) as string[];
        const lines = splitDesc.slice(0, 2);
        lines.forEach((line, i) => {
          doc.text(line, x + LABEL_W / 2, y + 5.5 + i * 3.5, { align: 'center' });
        });

        // Categoria/Ref (pequena, abaixo da descricao)
        if (p.category || p.ref) {
          doc.setFontSize(5.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(120);
          const meta = [p.category, p.ref ? `REF ${p.ref}` : null].filter(Boolean).join(' · ');
          doc.text(meta, x + LABEL_W / 2, y + 13, { align: 'center' });
          doc.setTextColor(0);
        }

        // Codigo de barras renderizado em canvas
        try {
          const canvas = document.createElement('canvas');
          JsBarcode(canvas, p.ean13!, {
            format: 'EAN13',
            width: 2,
            height: 50,
            displayValue: true,
            fontSize: 18,
            margin: 2,
            background: '#ffffff',
            lineColor: '#000000',
          });
          const dataUrl = canvas.toDataURL('image/png');
          const imgW = LABEL_W - 10;
          const imgH = 16;
          doc.addImage(dataUrl, 'PNG', x + 5, y + 15, imgW, imgH);
        } catch {
          doc.setFontSize(6);
          doc.setTextColor(150, 0, 0);
          doc.text('EAN invalido', x + LABEL_W / 2, y + 22, { align: 'center' });
          doc.setTextColor(0);
        }
      });
    }

    doc.save(`produtos-${now.toISOString().slice(0, 10)}.pdf`);
  };

  const exportProductsExcel = () => {
    if (filteredProducts.length === 0) {
      showAlert('Nenhum produto para exportar.');
      return;
    }
    const sep = ';';
    const esc = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    // Markup entra no CSV (que tem largura de sobra) mas não no PDF nem na
    // tabela: lá a briga é por espaço, e quem precisa dos dois lado a lado
    // está fazendo precificação numa planilha, não olhando a lista.
    const header = ['#', 'Nome', 'Categoria', 'EAN-13', 'Referência', 'Custo (R$)', 'Venda (R$)', 'Margem (%)', 'Markup (%)', 'Estoque', 'Unidade', 'Controla Estoque'];
    const lines = [header.map(esc).join(sep)];
    filteredProducts.forEach((p, i) => {
      const margem = p.price && p.costPrice ? (((p.price - p.costPrice) / p.price) * 100) : 0;
      const markup = p.price && p.costPrice ? (((p.price - p.costPrice) / p.costPrice) * 100) : 0;
      const row = [
        String(i + 1).padStart(3, '0'),
        p.name || '',
        p.category || '',
        p.ean13 || '',
        p.ref || '',
        (p.costPrice || 0).toFixed(2).replace('.', ','),
        (p.price || 0).toFixed(2).replace('.', ','),
        margem.toFixed(1).replace('.', ','),
        markup.toFixed(1).replace('.', ','),
        p.controlStock === false ? '' : (p.stock || 0),
        p.unit || 'un',
        p.controlStock === false ? 'Não' : 'Sim',
      ];
      lines.push(row.map(esc).join(sep));
    });
    const bom = '﻿';
    const csv = bom + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const a = document.createElement('a');
    a.href = url;
    a.download = `produtos-${now.toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredSuppliers = suppliers.filter(s =>
    (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.document || '').includes(search)
  );

  const filteredServices = services.filter(s => {
    if ((s.pdvMode ?? 'supermax') !== nichoFilter) return false;
    const q = search.toLowerCase();
    return (s.name?.toLowerCase() || '').includes(q) ||
      (s.category?.toLowerCase() || '').includes(q);
  });

  const handleDelete = (id: string, type: string, name: string) => {
    setDeleteConfirm({ isOpen: true, id, type, name });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { id, type } = deleteConfirm;

    try {
      if (type === 'cliente') {
        await Storage.deleteClient(id);
        setClients(prev => prev.filter(c => c.id !== id));
      } else if (type === 'produto') {
        await Storage.deleteProduct(id);
        setProducts(prev => prev.filter(p => p.id !== id));
      } else if (type === 'fornecedor') {
        await Storage.deleteSupplier(id);
        setSuppliers(prev => prev.filter(s => s.id !== id));
      } else if (type === 'servico') {
        await Storage.deleteService(id);
        setServices(prev => prev.filter(s => s.id !== id));
      } else if (type === 'equipe') {
        // A pessoa pode operar em mais de uma empresa, e e UM registro so.
        // A lixeira desta lista significa "sai DESTA loja", nao "some do
        // sistema" — senao remover alguem da MaxLook o apagaria tambem do
        // SuperMax, onde ele continua trabalhando.
        const r = await Storage.removerUsuarioDaEmpresa(id, nichoFilter);

        if (r === 'ultima_empresa') {
          // Nao ha loja para tirar: esta e a unica. Deixar o usuario sem
          // nenhuma empresa o tornaria invisivel em todas as listas, sem
          // conseguir entrar em lugar nenhum — pior que apagar. Entao a
          // decisao volta para quem clicou, agora explicita.
          setDeleteConfirm(null);
          setExcluirContaConfirm({ id, name: deleteConfirm.name });
          return;
        }

        setUsers(prev => prev.filter(u => u.id !== id));
        toast.sucesso({
          titulo: `${deleteConfirm.name} saiu da ${FILIAL_META[nichoFilter].label}`,
          mensagem: 'A conta continua ativa nas outras empresas em que ele opera.',
        });
      }
    } catch (err: any) {
      // O catch cobre os cinco tipos; sem o nome, "Erro ao excluir" não dizia
      // sequer o que tinha falhado quando o operador apagava em série.
      showAlert(explicarErro(err, `excluir "${deleteConfirm.name}"`));
    }

    setDeleteConfirm(null);
  };

  const confirmStockAdjustment = async () => {
    if (!stockModal.product) return;

    const amount = stockModal.amount;
    const tipo = stockModal.action === 'sum' ? 'entrada' : stockModal.action === 'subtract' ? 'saida' : 'correcao';

    // Estoque negativo trava a venda inteira daquele produto depois: o PDV
    // recusa no carrinho e a finalize_sale_atomic levanta "Estoque
    // insuficiente". A função do banco recusa de novo com o saldo travado;
    // esta checagem, com o saldo da lista, só dá a mensagem sem ir ao banco.
    const saldoLista = Number(products.find(p => p.id === stockModal.product?.id)?.stock ?? stockModal.product.stock ?? 0);
    if (tipo === 'saida' && saldoLista - amount < 0) {
      showAlert(
        `Não dá para baixar ${amount} de "${stockModal.product.name}": o estoque atual é ${saldoLista}. ` +
        `Use "Corrigir" se o saldo do sistema estiver errado.`,
      );
      return;
    }

    // Uma chamada só: o banco trava o produto, calcula a partir do saldo
    // daquele instante e grava saldo + histórico juntos. Somar aqui no
    // cliente perdia a venda que caísse entre a leitura e a gravação. E só
    // o saldo muda — o formulário aberto não vai junto.
    // O sucesso só é anunciado DEPOIS que o banco confirma.
    let atual: number;
    let newStock: number;
    try {
      ({ saldoAnterior: atual, saldoNovo: newStock } = await Storage.ajustarEstoque(stockModal.product.id, tipo, amount));
    } catch (err: any) {
      showAlert(explicarErro(err, 'ajustar o estoque'));
      return;
    }

    const updatedProduct = { ...stockModal.product, stock: newStock };
    setProducts(prev => prev.map(p => p.id === stockModal.product?.id ? { ...p, stock: newStock } : p));
    if (editingItem && editingItem.id === stockModal.product.id) {
      setFormData((prev: any) => ({ ...prev, stock: newStock }));
      // O saldo já está gravado: o salvar do formulário não precisa (nem
      // deve) reenviá-lo, senão desfaria uma venda feita nesse meio tempo.
      setEditingItem((prev: any) => prev ? { ...prev, stock: newStock } : prev);
    }
    setStockModal({ isOpen: false, product: null, action: 'sum', amount: 0 });

    // "Estoque atualizado com sucesso" não dizia nem QUAL produto nem PARA
    // QUANTO — e ajuste de estoque é exatamente onde o operador precisa
    // conferir o número que ficou. O saldo novo, o anterior e a operação vão
    // no aviso; se o mínimo foi furado, isso vem junto, porque é a hora de
    // repor, não depois.
    const un = updatedProduct.unit || 'UN';
    const operacao = stockModal.action === 'sum'
      ? `Entrada de ${amount} ${un}`
      : stockModal.action === 'subtract'
        ? `Baixa de ${amount} ${un}`
        : 'Saldo corrigido';
    const minimo = updatedProduct.minStock || 0;
    const abaixoDoMinimo = updatedProduct.controlStock !== false && newStock <= minimo;
    toast.sucesso({
      titulo: `${updatedProduct.name}: ${atual} → ${newStock} ${un}`,
      mensagem: abaixoDoMinimo
        ? `${operacao}. Atenção: no mínimo de ${minimo} ${un} ou abaixo — hora de repor.`
        : `${operacao}.`,
    });
  };

  const handleEdit = (item: any, type: string) => {
    setEditingItem(item);
    setFormData({ ...item });
    if (type === 'cliente') setShowAddClient(true);
    if (type === 'produto') { setFichaOutro(new Set()); setMarginDraft(null); setMarkupDraft(null); setShowAddProduct(true); }
    if (type === 'servico') setShowAddService(true);
    if (type === 'fornecedor') setShowAddSupplier(true);
    if (type === 'equipe') {
      setNewUser({ name: item.name, email: item.email, password: item.password, role: item.role });
      setLojasForm((item.lojas ?? []) as string[]);
      setShowAddUser(true);
    }
  };

  // Validacao compartilhada por Cliente e Fornecedor — os dois cadastram a
  // mesma coisa (pessoa PF/PJ) e nenhum dos dois validava NADA: dava pra
  // gravar sem nome, com CPF invalido e em duplicata.
  //
  // `isValidCpfCnpj` ja existia em lib/masks.ts e nunca tinha sido chamada em
  // lugar nenhum do app.
  const validarPessoa = (
    lista: any[],
    rotulo: 'cliente' | 'fornecedor',
  ): string | null => {
    const nome = String(formData.name ?? '').trim();
    if (nome.length < 2) {
      return formData.type === 'PJ'
        ? 'Informe a razão social.'
        : `Informe o nome do ${rotulo}.`;
    }

    const doc = String(formData.document ?? '').replace(/\D/g, '');
    if (doc) {
      const esperado = formData.type === 'PJ' ? 14 : 11;
      if (doc.length !== esperado) {
        return formData.type === 'PJ'
          ? 'CNPJ incompleto — são 14 dígitos.'
          : 'CPF incompleto — são 11 dígitos.';
      }
      if (!isValidCpfCnpj(doc)) {
        return `${formData.type === 'PJ' ? 'CNPJ' : 'CPF'} inválido — confira os dígitos verificadores.`;
      }
      // Duplicata importa no fiado: dois cadastros da mesma pessoa viram dois
      // limites de credito, e o bloqueio por limite deixa de significar algo.
      const jaExiste = lista.find(x =>
        x.id !== editingItem?.id &&
        String(x.document ?? '').replace(/\D/g, '') === doc);
      if (jaExiste) {
        return `Já existe ${rotulo} com este documento: ${jaExiste.name}.`;
      }
    }

    const email = String(formData.email ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return 'E-mail inválido.';
    }
    return null;
  };

  // Trocar PF <-> PJ limpa o que era do outro tipo. Sem isso, digitar um CPF e
  // trocar pra PJ deixava os 11 digitos no campo com rotulo de CNPJ — e o
  // save gravava um documento que nao e nem um nem outro.
  const trocarTipoPessoa = (tipo: 'PF' | 'PJ') => {
    setFormData({
      ...formData,
      type: tipo,
      document: '',
      rg: tipo === 'PF' ? formData.rg : undefined,
      ie: tipo === 'PJ' ? formData.ie : undefined,
      tradeName: tipo === 'PJ' ? formData.tradeName : undefined,
    });
  };

  // Linha de identificação da pessoa para o toast: "Pessoa Jurídica ·
  // 12.345.678/0001-90". Sem documento não inventa texto — diz o que falta,
  // que é justamente o que trava a emissão depois.
  // Serviço não tem estoque: o que importa no aviso é preço, categoria e a
  // margem — que é o número que costuma sair errado quando se digita o custo.
  const resumoServico = (s: any): string => {
    const preco = Number(s?.price ?? 0);
    const custo = Number(s?.costPrice ?? 0);
    const margem = preco && custo ? ((preco - custo) / preco) * 100 : 0;
    return [
      formatBRL(preco),
      custo > 0 ? `margem ${margem.toFixed(1)}%` : 'sem custo informado',
      s?.category || 'sem categoria',
    ].join(' · ');
  };

  const resumoPessoa = (p: any): string => {
    const tipo = p?.type === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física';
    const doc = String(p?.document ?? '').trim();
    return doc ? `${tipo} · ${doc}` : `${tipo} · sem documento informado`;
  };

  const handleSave = async (type: string) => {
    try {
      if (type === 'cliente') {
        const erro = validarPessoa(clients, 'cliente');
        if (erro) { showAlert(erro); return; }
        formData.name = String(formData.name).trim();
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertClient(updated);
          setClients(prev => prev.map(c => c.id === editingItem.id ? updated : c));
          toast.sucesso({ titulo: `${updated.name} atualizado`, mensagem: resumoPessoa(updated) });
        } else {
          const newClient: Client = {
            type: 'PF', status: 'active', creditLimit: 0, balance: 0,
            ...formData,
            id: crypto.randomUUID(),
            // Nasce na empresa da sessao, como produto, servico e conta.
            pdvMode: nichoFilter,
          } as Client;
          await Storage.upsertClient(newClient);
          setClients(prev => [...prev, newClient]);
          toast.sucesso({
            titulo: `${newClient.name} cadastrado`,
            // `clients` já vem filtrado pela empresa da sessão, então a
            // contagem é a da loja que o toast está identificando na faixa.
            mensagem: `${resumoPessoa(newClient)} · ${clients.length + 1}º cliente da loja`,
          });
        }
        setShowAddClient(false);
      } else if (type === 'produto') {
        // Validacao: sem ela dava pra gravar produto sem nome e com preco 0 —
        // no PDV isso vira uma linha em branco que fecha venda por R$ 0,00.
        const nome = String(formData.name ?? '').trim();
        if (nome.length < 2) {
          showAlert('Informe o nome do produto.');
          return;
        }
        const preco = Number(formData.price ?? 0);
        if (!(preco > 0)) {
          showAlert('Informe o preço de venda — o PDV não vende item sem preço.');
          return;
        }
        const ean = String(formData.ean13 ?? '').trim();
        if (ean && !isValidEAN13(ean)) {
          showAlert('EAN-13 inválido. São 13 dígitos com dígito verificador — use o botão Gerar se não tiver o código do fabricante.');
          return;
        }
        const ref = String(formData.ref ?? '').trim();
        const pdvAlvo = editingItem?.pdvMode ?? nichoFilter;
        // Duplicidade dentro da MESMA empresa: REF e EAN são o que o PDV usa
        // pra achar o produto (produtoBusca casa por prefixo de ref/EAN), e
        // dois produtos com a mesma REF na mesma loja fazem o caixa vender
        // sempre o primeiro da lista, em silêncio.
        if (ref) {
          const refDuplicada = products.some(p =>
            p.id !== editingItem?.id &&
            (p.pdvMode ?? 'supermax') === pdvAlvo &&
            String(p.ref ?? '').trim().toLowerCase() === ref.toLowerCase());
          if (refDuplicada) {
            showAlert(`Já existe um produto com a REF "${ref}" nesta empresa. Use outro código.`);
            return;
          }
        }
        if (ean) {
          const eanDuplicado = products.some(p =>
            p.id !== editingItem?.id &&
            (p.pdvMode ?? 'supermax') === pdvAlvo &&
            String(p.ean13 ?? '').trim() === ean);
          if (eanDuplicado) {
            showAlert(`Já existe um produto com este código de barras nesta empresa.`);
            return;
          }
        }
        // Ficha do nicho (MaxLook/TechMax) — os campos marcados `req` em
        // ATRIBUTOS_PRODUTO. SuperMax não tem lista, então o loop não roda.
        //
        // Só trava em CADASTRO NOVO. Editando um produto que já existia antes
        // da ficha (catálogo real de MaxLook/TechMax nasceu sem ela), travar
        // aqui faria uma alteração de preço de rotina exigir Modelo/Estado/
        // Garantia que ninguém preencheu — o operador não tem como corrigir
        // 100+ produtos de uma vez só pra mudar um valor. Fica opcional na
        // edição; quem quiser completar a ficha, completa quando puder.
        if (!editingItem) {
          const atrDefs = ATRIBUTOS_PRODUTO[pdvAlvo] ?? [];
          for (const d of atrDefs) {
            if (!d.req) continue;
            const v = (formData.atributos as any)?.[d.key];
            if (v === undefined || v === null || String(v).trim() === '') {
              showAlert(`Preencha "${d.label}" — é obrigatório em ${FILIAL_META[pdvAlvo as keyof typeof FILIAL_META]?.label ?? pdvAlvo}.`);
              return;
            }
          }
        }
        const custo = Number(formData.costPrice ?? 0);

        const gravarProduto = async () => {
          const productFields = { ...formData } as any;
          const finalStock = formData.stock || 0;
          // A empresa NAO vem do formulario: e a da sessao. Deixar escolher
          // permitia cadastrar produto na MaxLook estando dentro da TechMax.
          productFields.pdvMode = pdvAlvo;
          productFields.name = nome;
          productFields.ean13 = ean;
          // SuperMax não tem ficha — zera em vez de arrastar resíduo de uma
          // troca de nicho que nunca deveria ter acontecido no formulário.
          productFields.atributos = pdvAlvo === 'supermax' ? {} : (formData.atributos ?? {});
          // Unidade sempre UN fora de SuperMax — boutique e loja de eletrônico
          // não vendem a granel, e o select de KG/LT/M² só confundia lá.
          if (pdvAlvo !== 'supermax') productFields.unit = 'UN';
          // `ref` e o codigo curto que o operador digita no PDV ("agua", "pao").
          // Nao existia campo no formulario, entao todo produto novo nascia sem
          // ele e nao dava pra chamar pelo codigo no caixa.
          productFields.ref = ref;
          // O que o operador confere depois de salvar é preço e saldo — é o
          // que erra e o que o PDV vai cobrar. Vai no aviso, junto com a
          // margem, que ele acabou de calcular no formulário.
          const custoProd = Number(productFields.costPrice ?? 0);
          const margemProd = preco && custoProd ? ((preco - custoProd) / preco) * 100 : 0;
          const resumoProduto = (saldo: number) => [
            formatBRL(preco),
            custoProd > 0 ? `margem ${margemProd.toFixed(1)}%` : 'sem custo informado',
            productFields.controlStock === false
              ? 'sem controle de estoque'
              : `${saldo} ${productFields.unit || 'UN'} em estoque`,
          ].join(' · ');
          try {
            if (editingItem) {
              // O estoque nunca vai no upsert do formulário: sem `stock` no
              // payload o upsert não toca a coluna, e uma venda feita com o
              // formulário aberto não é desfeita ao salvar uma troca de preço.
              // Se o Admin Master mudou o saldo no campo, a correção vai pela
              // função atômica, que também grava o histórico.
              const estoqueMexido = Number(formData.stock ?? 0) !== Number(editingItem.stock ?? 0);
              const { stock: _saldo, ...semEstoque } = { ...editingItem, ...productFields };
              await Storage.upsertProduct(semEstoque as any);
              let saldo = Number(products.find(p => p.id === editingItem.id)?.stock ?? editingItem.stock ?? 0);
              if (estoqueMexido) {
                try {
                  saldo = (await Storage.ajustarEstoque(editingItem.id, 'correcao', Number(finalStock))).saldoNovo;
                } catch (err: any) {
                  const e = explicarErro(err, 'corrigir o estoque');
                  showAlert({ ...e, message: `Os dados do produto foram salvos, mas o estoque não. ${e.message}` });
                }
              }
              const updated = { ...editingItem, ...productFields, stock: saldo };
              setProducts(prev => prev.map(p => p.id === editingItem.id ? updated : p));
              toast.sucesso({ titulo: `${nome} atualizado`, mensagem: resumoProduto(saldo) });
            } else {
              const newProduct = {
                unit: 'UN', stock: finalStock, minStock: 0, costPrice: 0, price: 0, controlStock: true,
                ...productFields,
                id: 'P-' + crypto.randomUUID(),
              };
              await Storage.upsertProduct(newProduct);
              setProducts(prev => [...prev, newProduct]);
              toast.sucesso({
                titulo: `${nome} cadastrado`,
                mensagem: `${resumoProduto(Number(finalStock))}${ref ? ` · REF ${ref}` : ''}`,
              });
            }
            setShowAddProduct(false);
            setEditingItem(null);
            setFormData({});
          } catch (err: any) {
            showAlert(explicarErro(err, `salvar o produto "${nome}"`));
          }
        };

        // Custo maior que o preço de venda é legítimo (queima de estoque,
        // liquidação) — vira confirmação, não trava mais o cadastro.
        if (custo > preco) {
          askConfirm({
            title: 'Margem negativa',
            message: `O custo (${formatBRL(custo)}) é maior que o preço de venda (${formatBRL(preco)}). A margem fica negativa. Salvar mesmo assim?`,
            confirmLabel: 'Salvar assim mesmo',
            variant: 'primary',
            onConfirm: gravarProduto,
          });
          return;
        }
        await gravarProduto();
        return;
      } else if (type === 'servico') {
        const nomeSrv = String(formData.name ?? '').trim();
        if (nomeSrv.length < 2) { showAlert('Informe o nome do serviço.'); return; }
        if (!(Number(formData.price ?? 0) > 0)) {
          showAlert('Informe o preço do serviço.');
          return;
        }
        formData.name = nomeSrv;
        // Mesma regra do produto: a empresa e a da sessao.
        (formData as any).pdvMode = editingItem?.pdvMode ?? nichoFilter;
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertService(updated);
          setServices(prev => prev.map(s => s.id === editingItem.id ? updated : s));
          toast.sucesso({ titulo: `${nomeSrv} atualizado`, mensagem: resumoServico(updated) });
        } else {
          const newService = {
            costPrice: 0, price: 0,
            ...formData,
            id: 'S-' + crypto.randomUUID(),
          };
          await Storage.upsertService(newService);
          setServices(prev => [...prev, newService]);
          toast.sucesso({ titulo: `${nomeSrv} cadastrado`, mensagem: resumoServico(newService) });
        }
        setShowAddService(false);
      } else if (type === 'fornecedor') {
        const erro = validarPessoa(suppliers, 'fornecedor');
        if (erro) { showAlert(erro); return; }
        formData.name = String(formData.name).trim();
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertSupplier(updated);
          setSuppliers(prev => prev.map(s => s.id === editingItem.id ? updated : s));
          toast.sucesso({ titulo: `${updated.name} atualizado`, mensagem: resumoPessoa(updated) });
        } else {
          const newSupplier = {
            type: 'PF',
            ...formData,
            id: 'F-' + crypto.randomUUID(),
            pdvMode: nichoFilter,
          };
          await Storage.upsertSupplier(newSupplier);
          setSuppliers(prev => [...prev, newSupplier]);
          toast.sucesso({
            titulo: `${newSupplier.name} cadastrado`,
            mensagem: `${resumoPessoa(newSupplier)} · ${suppliers.length + 1}º fornecedor da loja`,
          });
        }
        setShowAddSupplier(false);
      }
    } catch (err: any) {
      // `type` diz qual formulário estava aberto — este catch é comum a
      // cliente, serviço e fornecedor.
      showAlert(explicarErro(err, `salvar o ${type}${formData.name ? ` "${String(formData.name).trim()}"` : ''}`));
    }
    setEditingItem(null);
    setFormData({});
  };

  const handleView = (item: any) => {
    setViewingDetails(item);
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  // ─── Categorias ──────────────────────────────────────────
  const salvarCategoria = async () => {
    if (!catForm) return;
    const nome = catForm.name.trim();
    if (nome.length < 2) { showAlert('Informe o nome da categoria.'); return; }
    // A empresa é SEMPRE a da sessão, nunca o que veio no formulário. Vale
    // também ao EDITAR: uma categoria de outra empresa não aparece nesta tela,
    // então o que está aqui é, por construção, da empresa ativa. Amarrar isto
    // aqui em vez de confiar no estado do form é o que fecha o furo — o seletor
    // saiu da tela, mas quem grava é esta função.
    const categoria: Category = { ...catForm, name: nome, pdvMode: nichoFilter };

    // A trava real é o índice único no banco (nome+pdv_mode, sem caixa). Aqui
    // só antecipamos a mensagem pra não fazer o operador esperar o erro 23505.
    // A lista já vem só desta empresa, então comparar o nome basta.
    const duplicada = categories.some(c =>
      c.id !== catForm.id &&
      c.name.trim().toLowerCase() === nome.toLowerCase());
    if (duplicada) {
      showAlert(`Já existe a categoria "${nome}" na ${FILIAL_META[nichoFilter].label}.`);
      return;
    }
    setCatSaving(true);
    try {
      const original = categories.find(c => c.id === catForm.id);
      const renomeando = !!original && original.name !== nome;
      // Contado ANTES do rename, senão o nome antigo já não existe pra contar.
      // Renomear mexe em todos os itens que usam a categoria, e o operador
      // merece saber quantos foram — é o efeito colateral da operação.
      const afetados = renomeando
        ? await Storage.countCategoryUsage(original!.name, nichoFilter)
        : 0;
      if (renomeando) {
        // Renomear arrasta os produtos junto — ver Storage.renameCategory.
        // O pdvMode é obrigatório aqui: sem ele o rename atravessava as
        // empresas, porque o mesmo nome de categoria existe nas três.
        await Storage.renameCategory(catForm.id, original.name, nome, nichoFilter);
      }
      await Storage.upsertCategory(categoria);
      setCategories(await Storage.getCategories(nichoFilter));
      // Escopado como a carga inicial: sem o nicho, renomear uma categoria
      // repovoava o estado com o catálogo das três empresas (e as imagens).
      setProducts(await Storage.getProducts(nichoFilter));
      setServices(await Storage.getServices(nichoFilter));
      setCatForm(null);
      // Salvar categoria não dava sinal nenhum — e renomear, que reescreve a
      // categoria de todos os itens, era a operação mais silenciosa da tela.
      if (renomeando) {
        toast.sucesso({
          titulo: `"${original!.name}" agora é "${nome}"`,
          mensagem: afetados > 0
            ? `${afetados} ${afetados === 1 ? 'item acompanhou' : 'itens acompanharam'} a mudança.`
            : 'Nenhum item usava esta categoria ainda.',
        });
      } else if (original) {
        toast.sucesso({ titulo: `Categoria "${nome}" atualizada` });
      } else {
        toast.sucesso({
          titulo: `Categoria "${nome}" criada`,
          mensagem: 'Já aparece na lista de categorias do formulário de produtos e serviços.',
        });
      }
    } catch (err: any) {
      showAlert(explicarErro(err, 'salvar a categoria'));
    } finally {
      setCatSaving(false);
    }
  };

  const excluirCategoria = async (c: Category) => {
    // Categoria em uso não some sem aviso: apagar deixaria os produtos
    // apontando pra um nome que não existe mais no cadastro.
    const emUso = await Storage.countCategoryUsage(
      c.name, (c.pdvMode ?? nichoFilter) as any);
    if (emUso > 0) {
      showAlert(`"${c.name}" está em uso por ${emUso} item(ns). Renomeie ou troque a categoria desses itens antes de excluir.`);
      return;
    }
    try {
      await Storage.deleteCategory(c.id);
      setCategories(await Storage.getCategories(nichoFilter));
      toast.sucesso({ titulo: `Categoria "${c.name}" excluída`, mensagem: 'Nenhum item usava ela.' });
    } catch (err: any) {
      showAlert(explicarErro(err, `excluir a categoria "${c.name}"`));
    }
  };

  // Opções de categoria vindas do CADASTRO, escopadas pelo PDV do item. Antes
  // as duas telas tinham uma lista fixa no código (Bebidas/Comidas/... e
  // Manutenção/Consultoria/...) que não conversava com o que os produtos
  // realmente usavam nem com o que o PDV agrupa em chips.
  // Escopo estrito: sem categoria cadastrada NESTA empresa, a lista vem
  // vazia — nunca cai para as categorias de outra loja. O fallback antigo
  // ("se não tem nenhuma, mostra todas") vazava Roupas/Calçados da MaxLook
  // pro formulário da TechMax sempre que a empresa ainda não tinha
  // categoria própria cadastrada.
  const opcoesCategoria = (modo?: string) => {
    const alvo = modo ?? 'supermax';
    return categories.filter(c => c.active && (c.pdvMode ?? 'supermax') === alvo);
  };

  // Cliente e fornecedor tinham o mesmo formulário copiado duas vezes; o que
  // muda é só o que o cliente tem a mais (aniversário e limite de crédito).
  const renderFormPessoa = (kind: 'cliente' | 'fornecedor') => {
    const ehPJ = formData.type === 'PJ';
    const ehCliente = kind === 'cliente';
    const set = (campo: string, valor: any) => setFormData((prev: any) => ({ ...prev, [campo]: valor }));
    const fechar = () => {
      if (ehCliente) setShowAddClient(false); else setShowAddSupplier(false);
      setEditingItem(null);
      setFormData({});
    };
    const docInvalido = (() => {
      const d = String(formData.document ?? '').replace(/\D/g, '');
      return d.length === (ehPJ ? 14 : 11) && !isValidCpfCnpj(d);
    })();

    return (
      <div className="fixed inset-0 min-h-screen z-[80] overflow-y-auto bg-black/70 backdrop-blur-md animate-in fade-in duration-200 p-4 flex justify-center items-start">
        <div className="form-cadastro p-5 md:p-8 animate-in slide-in-from-top duration-300 max-w-5xl w-full my-8">
          <CabecalhoForm titulo={`${editingItem ? 'Editar' : 'Novo'} ${kind}`} onFechar={fechar} />

          <div className="space-y-5">
            <section className="fc-section">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
                <h4 className="fc-section-title !mb-0">
                  <UserIcon size={18} /> {ehPJ ? 'Dados da empresa' : 'Dados pessoais'}
                </h4>
                <BotaoMaxID pj={ehPJ} />
              </div>

              <div className="flex flex-col md:flex-row md:items-center gap-5 mb-5">
                <Segmentado
                  rotulo="Tipo de pessoa"
                  valor={ehPJ ? 'PJ' : 'PF'}
                  opcoes={[{ valor: 'PF', rotulo: 'Pessoa física' }, { valor: 'PJ', rotulo: 'Pessoa jurídica' }]}
                  onChange={trocarTipoPessoa}
                />
                {/* Foto antes dos campos: é a primeira coisa que identifica o
                    cadastro no card da lista. */}
                <CampoFoto
                  nome={formData.name || ''}
                  image={formData.image}
                  onChange={img => set('image', img)}
                  onErro={msg => showAlert(msg)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="fc-label">{ehPJ ? 'Razão social' : 'Nome completo'}<Obrigatorio /></label>
                  <input
                    value={formData.name || ''}
                    onChange={e => set('name', e.target.value)}
                    className={CAMPO}
                    placeholder={ehPJ ? (ehCliente ? 'Ex.: Empresa LTDA' : 'Ex.: Fornecedor LTDA') : (ehCliente ? 'Ex.: João Silva' : 'Ex.: José Silva')}
                  />
                </div>

                {ehPJ && (
                  <div className="space-y-1.5">
                    <label className="fc-label">Nome fantasia</label>
                    <input
                      value={formData.tradeName || ''}
                      onChange={e => set('tradeName', e.target.value)}
                      className={CAMPO}
                      placeholder="Como a empresa é conhecida"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="fc-label">{ehPJ ? 'CNPJ' : 'CPF'}</label>
                  <input
                    value={formData.document || ''}
                    onChange={e => set('document', ehPJ ? maskCNPJ(e.target.value) : maskCPF(e.target.value))}
                    inputMode="numeric"
                    className={`${CAMPO} font-mono`}
                    placeholder={ehPJ ? '00.000.000/0000-00' : '000.000.000-00'}
                  />
                  {/* Erro ao DIGITAR, não só ao salvar: descobrir um dígito errado
                      depois de preencher a ficha inteira é o pior momento.
                      Só reclama com o documento completo — senão acusaria enquanto
                      o operador ainda está no meio da digitação. */}
                  {docInvalido && (
                    <p className="text-xs font-semibold text-red-600">
                      {ehPJ ? 'CNPJ' : 'CPF'} inválido — confira os dígitos.
                    </p>
                  )}
                </div>

                {ehPJ ? (
                  <div className="space-y-1.5">
                    <label className="fc-label">Inscrição estadual (IE)</label>
                    <input
                      value={formData.ie || ''}
                      onChange={e => set('ie', e.target.value)}
                      className={`${CAMPO} font-mono`}
                      placeholder="Somente números"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="fc-label">RG</label>
                    <input
                      value={formData.rg || ''}
                      onChange={e => set('rg', maskRG(e.target.value))}
                      className={`${CAMPO} font-mono`}
                      placeholder="00.000.000-0"
                    />
                  </div>
                )}

                {ehCliente && (
                  <>
                    <div className="space-y-1.5">
                      <label className="fc-label">{ehPJ ? 'Data de fundação' : 'Data de aniversário'}</label>
                      <input
                        type="date"
                        value={formData.birthDate || ''}
                        onChange={e => set('birthDate', e.target.value)}
                        className={CAMPO}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="fc-label">Limite de crédito (R$)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={maskCurrency(Math.round((formData.creditLimit || 0) * 100))}
                        onChange={e => set('creditLimit', parseCurrencyToNumber(e.target.value))}
                        className={`${CAMPO} !font-bold`}
                      />
                      <p className="fc-hint">Quanto o cliente pode comprar fiado.</p>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="fc-section">
              <h4 className="fc-section-title"><Phone size={18} /> Contato</h4>
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${ehCliente ? 'lg:grid-cols-3' : ''}`}>
                {/* Com empresa, quem atende não é a razão social: é esse nome
                    que aparece no rodapé do card do fornecedor. */}
                {!ehCliente && (
                  <div className="space-y-1.5">
                    <label className="fc-label">Pessoa de contato</label>
                    <input
                      value={formData.contact || ''}
                      onChange={e => set('contact', e.target.value)}
                      className={CAMPO}
                      placeholder="Ex.: Carlos (representante comercial)"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="fc-label">Celular</label>
                  <input
                    value={formData.cellphone || ''}
                    onChange={e => set('cellphone', maskCellphone(e.target.value))}
                    inputMode="tel"
                    className={CAMPO}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="fc-label">Telefone fixo</label>
                  <input
                    value={formData.phone || ''}
                    onChange={e => set('phone', maskPhone(e.target.value))}
                    inputMode="tel"
                    className={CAMPO}
                    placeholder="(00) 0000-0000"
                  />
                </div>
                <div className={`space-y-1.5 ${ehCliente ? 'md:col-span-2 lg:col-span-1' : ''}`}>
                  <label className="fc-label">E-mail</label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={e => set('email', e.target.value)}
                    className={CAMPO}
                    placeholder="email@exemplo.com"
                  />
                </div>
              </div>
            </section>

            <section className="fc-section">
              <h4 className="fc-section-title"><MapPin size={18} /> Endereço</h4>
              <ColarEnderecoMaxID onPreencher={campos => setFormData((prev: any) => ({ ...prev, ...campos }))} />
              {/* 12 colunas para cada campo ter a largura do que recebe: UF
                  tinha a largura do bairro para guardar duas letras. */}
              <div className="grid grid-cols-2 md:grid-cols-12 gap-4">
                <div className="space-y-1.5 col-span-2 md:col-span-3">
                  <label className="fc-label">CEP</label>
                  <input
                    value={formData.zipCode || ''}
                    onChange={e => set('zipCode', maskCEP(e.target.value))}
                    inputMode="numeric"
                    className={CAMPO}
                    placeholder="00000-000"
                  />
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-7">
                  <label className="fc-label">Endereço</label>
                  <input
                    value={formData.address || ''}
                    onChange={e => set('address', e.target.value)}
                    className={CAMPO}
                    placeholder="Rua, avenida..."
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="fc-label">Número</label>
                  <input
                    value={formData.number || ''}
                    onChange={e => set('number', e.target.value)}
                    className={CAMPO}
                    placeholder="123"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-4">
                  <label className="fc-label">Bairro</label>
                  <input
                    value={formData.neighborhood || ''}
                    onChange={e => set('neighborhood', e.target.value)}
                    className={CAMPO}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-6">
                  <label className="fc-label">Cidade</label>
                  <input
                    value={formData.city || ''}
                    onChange={e => set('city', e.target.value)}
                    className={CAMPO}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="fc-label">UF</label>
                  <input
                    value={formData.state || ''}
                    onChange={e => set('state', e.target.value)}
                    className={`${CAMPO} uppercase`}
                    maxLength={2}
                    placeholder="SP"
                  />
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-12">
                  <label className="fc-label">Complemento</label>
                  <input
                    value={formData.complement || ''}
                    onChange={e => set('complement', e.target.value)}
                    className={CAMPO}
                    placeholder="Apto, sala, ponto de referência"
                  />
                </div>
              </div>
            </section>

            <section className="fc-section">
              <h4 className="fc-section-title"><FileText size={18} /> Observações</h4>
              <textarea
                value={formData.observations || ''}
                onChange={e => set('observations', e.target.value)}
                className={`${CAMPO} min-h-[88px]`}
                placeholder={`Observações importantes sobre o ${kind}...`}
              />
            </section>
          </div>

          <RodapeForm
            rotulo={editingItem ? 'Salvar alterações' : `Salvar ${kind}`}
            onCancelar={fechar}
            onSalvar={() => handleSave(kind)}
          />
        </div>
      </div>
    );
  };

  const renderTable = () => {
    switch (subTab) {
      case 'categorias': {
        const usos = (nome: string) =>
          products.filter((p: any) => (p.category ?? '') === nome).length +
          services.filter((s: any) => (s.category ?? '') === nome).length;
        const lista = categories.filter(c =>
          (c.pdvMode ?? 'supermax') === nichoFilter &&
          c.name.toLowerCase().includes(search.toLowerCase()));
        return (
          <table className="tabela-lista w-full text-left min-w-[720px]">
            <thead className="text-black text-sm font-bold sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
              <tr>
                <th className="px-5 py-4">Categoria</th>
                {/* A coluna PDV saiu junto com o FilialBadge: mostrava a
                    empresa da sessao em toda linha, e a lista ja filtra por
                    ela. Sem esta remocao o cabecalho ficaria com uma coluna a
                    mais que o corpo e a tabela inteira desalinhava. */}
                <th className="px-5 py-4 text-right">Itens</th>
                <th className="px-5 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {lista.map(c => (
                <tr key={c.id}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      {/* A foto era gravada no cadastro, mas a lista só
                          desenhava a bolinha de cor — quem punha imagem não
                          a via em lugar nenhum. Sem foto, a cor ocupa o lugar. */}
                      {c.image ? (
                        <img
                          src={c.image}
                          alt=""
                          className="w-11 h-11 rounded-lg object-cover shrink-0 border-2"
                          style={{ borderColor: c.color ?? '#d1d5db' }}
                        />
                      ) : (
                        <span className="w-11 h-11 rounded-lg shrink-0 border"
                          style={{ background: c.color ?? '#9ca3af', borderColor: 'rgba(0,0,0,0.2)' }} />
                      )}
                      <span className="font-bold text-gray-900">{c.name}</span>
                      {!c.active && (
                        <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 border rounded px-1.5 py-0.5">inativa</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums font-bold" style={{ color: 'var(--navy)' }}>{usos(c.name)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setCatForm(c)} title="Editar" className="row-action-btn is-editar">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => excluirCategoria(c)} title="Excluir" className="row-action-btn is-excluir">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-gray-500">
                  Nenhuma categoria cadastrada nesta empresa.
                </td></tr>
              )}
            </tbody>
          </table>
        );
      }
      case 'equipe':
        return (
          <table className="tabela-lista w-full text-left min-w-[720px]">
            <thead className="text-black text-sm font-bold sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
              <tr>
                <th className="px-5 py-3">Membro</th>
                <th className="px-5 py-3">Cargo</th>
                <th className="px-5 py-3">Empresas</th>
                <th className="px-5 py-3 w-28">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <AvatarCadastro nome={u.name} size={36} />
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 flex items-center gap-2">
                          <span className="truncate">{u.name}</span>
                          {u.id === currentUser?.id && (
                            <span className="text-[11px] font-semibold px-1.5 py-px rounded bg-[var(--accent)] text-[var(--accent-fg)] shrink-0">você</span>
                          )}
                        </p>
                        <p className="text-sm text-gray-600 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${COR_CARGO[u.role] ?? 'bg-gray-100 text-gray-800'}`}>
                      {ROLE_LABELS[u.role] ?? u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {/* Operador de caixa pode atender só uma parte das lojas —
                        antes isso só se via abrindo o cadastro. */}
                    <div className="flex flex-wrap gap-1.5">
                      {(['supermax', 'maxlook', 'techmax'] as const)
                        .filter(f => (u.lojas ?? []).includes(f))
                        .map(f => {
                          const m = FILIAL_META[f];
                          return (
                            <span key={f} className="px-2 py-0.5 rounded-full text-xs font-semibold border" style={{ background: m.color, color: m.fg, borderColor: m.dark }}>
                              {m.label}
                            </span>
                          );
                        })}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {/* A tela nao oferece o que o banco vai negar: quem esta no
                        seu nivel ou acima (o Admin Master, para todo mundo)
                        aparece como somente leitura. Antes bastava ter algum
                        cargo concedivel para os botoes surgirem em TODA linha,
                        e o clique so morria no erro do trigger. */}
                    {availableRoles.length > 0 && podeEditarUsuario(u) ? (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleEdit(u, 'equipe')}
                          className="row-action-btn is-editar"
                          title="Editar"
                        >
                          <Edit2 size={16} className="relative z-[2]" />
                        </button>
                        {/* Editar e excluir nao andam juntos: a propria pessoa
                            edita nome e avatar, mas nao se exclui — a
                            delete_user_completely recusa auto-delecao e exige
                            nivel 80. */}
                        {podeExcluirCadastro && u.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDelete(u.id, 'equipe', u.name)}
                            className="row-action-btn is-excluir"
                            title="Excluir"
                          >
                            <Trash2 size={16} className="relative z-[2]" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600">
                        {u.role === 'admin_master' ? 'Não editável' : 'Somente leitura'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'produtos':
        // min-w 880 e o que a tabela precisa SEM a coluna Margem (que some em
        // container estreito). Estava em 1000 e forcava rolagem horizontal numa
        // tela de 1280 so pra sobrar espaco vazio.
        return (
          <table className="tabela-lista w-full text-left min-w-[880px]">
            <thead className="text-black text-sm font-bold sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
              <tr>
                <th className="px-5 py-3">Produto</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 text-right">Custo</th>
                <th className="px-4 py-3 text-right">Venda</th>
                {/* Margem some quando a tabela tem menos de 1100px: e o unico
                    valor DERIVADO (sai de Custo x Venda), entao e o primeiro
                    que pode ceder quando a largura aperta. */}
                <th className="px-5 py-3 text-right hidden @[1100px]:table-cell">Margem</th>
                <th className="px-4 py-3 text-right">Estoque</th>
                {/* A coluna "Cód. Barras" saiu: a coluna Produto ja mostra
                    "EAN 7896187755481" embaixo do nome, e esta repetia o mesmo
                    numero 140px adiante — 140px gastos pra dizer duas vezes a
                    mesma coisa numa tabela que ja nao cabia na tela. */}
                <th className="px-3 py-3 text-center col-acoes-fixa">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-base">
              {filteredProducts.map((p) => {
                const margem = p.price && p.costPrice ? (((p.price - p.costPrice) / p.price) * 100) : 0;
                // Mesma régua dos alertas da tela de Estoque; "perto" é até 50%
                // acima do mínimo, para dar tempo de comprar antes de faltar.
                const minimo = p.minStock ?? 5;
                const stockBaixo = p.controlStock !== false && p.stock <= minimo;
                const stockPerto = p.controlStock !== false && !stockBaixo && minimo > 0 && p.stock <= minimo * 1.5;
                return (
                <tr key={p.id}>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded border border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                        {p.image ? (
                          <img src={p.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package size={22} className="text-gray-400" />
                        )}
                      </div>
                      {/* max-w e o que faz o `truncate` valer alguma coisa aqui:
                          `whitespace-nowrap` empurra a largura MINIMA da coluna
                          ate o nome inteiro caber ("Detergente Liquido Ype
                          Clear 500ml" = ~500px), a tabela estourava o container
                          e a coluna Estoque acabava escondida embaixo de Acoes,
                          que e sticky. Com o teto, o nome corta e a tabela cabe. */}
                      <div className="min-w-0 max-w-[220px] @[1400px]:max-w-[320px]">
                        <div className="font-bold text-gray-900 text-base truncate">{p.name}</div>
                        {/* Identificação útil pra quem opera: REF e código de
                            barras. O UUID interno não é digitável, não é
                            conferível na etiqueta e só roubava a linha. */}
                        {(p.ref || p.ean13) && (
                          <div className="text-xs text-gray-500 font-mono mt-0.5 truncate">
                            {p.ref && <span>REF {p.ref}</span>}
                            {p.ref && p.ean13 && <span className="mx-1.5 opacity-40">·</span>}
                            {p.ean13 && <span>EAN {p.ean13}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {/* Uma linha só: "Mercearia Seca e Despensa" quebrava em duas e cada
                        produto ficava com o dobro da altura. O nome inteiro vai
                        no tooltip. */}
                    <span className="inline-block max-w-[8rem] @[1400px]:max-w-[12rem] truncate align-middle bg-slate-100 text-slate-800 border border-slate-200 px-2.5 py-1 rounded-md text-sm font-semibold" title={p.category || undefined}>{p.category || '—'}</span>
                  </td>
                  {/* whitespace-nowrap: formatBRL devolve "R$ 4,50" com espaco
                      normal, e na largura desta coluna o "R$" ficava numa linha
                      e o valor na de baixo — em TODAS as 59 linhas. */}
                  <td className="px-4 py-4 text-right tabular-nums text-base text-gray-500 whitespace-nowrap">
                    {formatBRL(p.costPrice)}
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums text-base font-bold whitespace-nowrap" style={{ color: 'var(--navy)' }}>
                    {formatBRL(p.price)}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums hidden @[1100px]:table-cell">
                    <div className="font-bold text-base" style={{ color: 'var(--navy)' }}>{margem.toFixed(1)}%</div>
                  </td>
                  <td className="px-4 py-4 text-right">
                    {p.controlStock === false ? (
                      <span className="text-sm bg-gray-100 text-gray-700 px-2.5 py-1 rounded font-semibold whitespace-nowrap">Sem controle</span>
                    ) : (
                      <span
                        className={`inline-flex items-baseline gap-1 tabular-nums font-black text-lg rounded-md px-2 py-0.5 ${
                          stockBaixo ? 'bg-red-100 text-red-700' : stockPerto ? 'bg-amber-100 text-amber-800' : 'text-gray-900'
                        }`}
                        title={stockBaixo ? `Abaixo do mínimo (${minimo})` : stockPerto ? `Perto do mínimo (${minimo})` : undefined}
                      >
                        {p.stock} <span className="text-xs font-semibold opacity-70">{p.unit || 'un'}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-4 col-acoes-fixa">
                    {/* Quatro botoes solidos com gradiente e shimmer POR LINHA
                        somavam 236 pecas brilhantes numa lista de 59 produtos: a
                        tela inteira piscava e nada se destacava, porque tudo se
                        destacava. Fantasmas — ganham cor quando o ponteiro chega. */}
                    <div className="flex gap-0.5 justify-center">
                      <button
                        onClick={() => setBarcodeModal({ isOpen: true, product: p })}
                        className="row-action-btn is-etiqueta"
                        title="Gerar etiqueta"
                      >
                        <Barcode size={16} />
                      </button>
                      <button
                        onClick={() => handleEdit(p, 'produto')}
                        className="row-action-btn is-editar"
                        title="Editar"
                      >
                        <Edit2 size={16} />
                      </button>
                      {podeExcluirCadastro && (
                        <button
                          onClick={() => handleDelete(p.id, 'produto', p.name)}
                          className="row-action-btn is-excluir"
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleView(p)}
                        className="row-action-btn is-detalhes"
                        title="Detalhes"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        );
      case 'servicos':
        return (
          <table className="tabela-lista w-full text-left min-w-[900px]">
            <thead className="text-black text-sm font-bold sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
              <tr>
                <th className="p-6">Serviço</th>
                <th className="p-6">Categoria</th>
                <th className="p-6">Custo</th>
                <th className="p-6">Venda</th>
                <th className="p-6">Margem (Lucro)</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredServices.map((s) => (
                <tr key={s.id} className="group">
                  <td className="p-6">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="font-bold text-gray-900">{s.name}</div>
                    </div>
                  </td>
                  <td className="p-6 text-sm text-gray-600">
                    <span className="bg-gray-100 px-2 py-1 rounded text-sm font-black uppercase tracking-widest">{s.category}</span>
                  </td>
                  <td className="p-6 font-mono text-xs text-red-500/70">R$ {s.costPrice ? s.costPrice.toFixed(2) : '0.00'}</td>
                  <td className="p-6 font-mono font-black text-emerald-500">R$ {s.price.toFixed(2)}</td>
                  <td className="p-6">
                    <div className="flex flex-col">
                      <span className="font-black text-xs text-[var(--navy)]">
                        {s.price && s.costPrice ? (((s.price - s.costPrice) / s.price) * 100).toFixed(1) : '0.0'}%
                      </span>
                      <span className="text-sm text-emerald-500 font-bold">R$ {(s.price - (s.costPrice || 0)).toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleEdit(s, 'servico')}
                        className="row-action-btn is-editar"
                        title="Editar"
                      >
                        <Edit2 size={16} className="relative z-[2]" />
                      </button>
                      {podeExcluirCadastro && (
                        <button
                          onClick={() => handleDelete(s.id, 'servico', s.name)}
                          className="row-action-btn is-excluir"
                          title="Excluir"
                        >
                          <Trash2 size={16} className="relative z-[2]" />
                        </button>
                      )}
                      <button
                        onClick={() => handleView(s)}
                        className="row-action-btn is-detalhes"
                        title="Detalhes"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      // Fornecedor e cliente saíram da tabela para card, como no LogMax: são
      // cadastros de QUINZE campos, e a linha só mostrava cinco. Ver CardPessoa.
      case 'fornecedores':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 @[1100px]:grid-cols-3 gap-5 p-1">
            {filteredSuppliers.map((s: any) => (
              <CardPessoa
                key={s.id}
                item={s}
                kind="fornecedor"
                podeExcluir={podeExcluirCadastro}
                onEdit={() => handleEdit(s, 'fornecedor')}
                onDelete={() => handleDelete(s.id, 'fornecedor', s.name)}
                onView={() => handleView(s)}
              />
            ))}
          </div>
        );
      default: // clientes
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 @[1100px]:grid-cols-3 gap-5 p-1">
            {filteredClients.map((client: any) => (
              <CardPessoa
                key={client.id}
                item={client}
                kind="cliente"
                podeExcluir={podeExcluirCadastro}
                onEdit={() => handleEdit(client, 'cliente')}
                onDelete={() => handleDelete(client.id, 'cliente', client.name)}
                onView={() => handleView(client)}
              />
            ))}
          </div>
        );
    }
  };

  const filteredCategories = categories.filter(c =>
    (c.pdvMode ?? 'supermax') === nichoFilter &&
    c.name.toLowerCase().includes(search.toLowerCase()));

  const currentListLength = subTab === 'categorias' ? filteredCategories.length :
                           subTab === 'clientes' ? filteredClients.length : 
                           subTab === 'produtos' ? filteredProducts.length :
                           subTab === 'servicos' ? filteredServices.length :
                           subTab === 'fornecedores' ? filteredSuppliers.length : 
                           filteredUsers.length;

  const totalLength = subTab === 'categorias' ? categories.length :
                      subTab === 'clientes' ? clients.length : 
                      subTab === 'produtos' ? products.length :
                      subTab === 'servicos' ? services.length :
                      subTab === 'fornecedores' ? suppliers.length : 
                      users.length;

  return (
    <div className="space-y-8 flex flex-col max-w-full">
      {alertHost}
      {confirmHost}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div className="flex gap-3 w-full xl:w-auto flex-wrap items-center">
          <div className="flex-1 md:w-64 neumorphic-inset flex items-center px-4 py-2 gap-3">
            <Search size={18} className="text-gray-600" />
            <input
              type="text"
              placeholder={`Buscar em ${subTab}...`}
              className="bg-transparent border-none outline-none text-gray-900 text-sm w-full font-medium placeholder:text-gray-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {subTab === 'produtos' && (
            <>
              <select
                value={categoriaFiltro}
                onChange={e => setCategoriaFiltro(e.target.value)}
                className="smart-input !w-auto !py-2 !text-sm max-w-[14rem]"
                aria-label="Filtrar por categoria"
              >
                <option value="">Todas as categorias</option>
                {[...new Set(products
                  .filter(p => (p.pdvMode ?? 'supermax') === nichoFilter && p.category)
                  .map(p => p.category as string))]
                  .sort((a, b) => a.localeCompare(b, 'pt-BR'))
                  .map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={exportProductsPDF}
                className="glass-blue shimmer-subtle px-4 py-2 rounded-xl flex items-center gap-2 text-xs tracking-widest uppercase font-black whitespace-nowrap border-2"
                style={{ borderColor: 'var(--accent)' }}
                title="Exportar lista filtrada em PDF"
              >
                <FileText size={18} className="relative z-[2]" />
                <span className="relative z-[2]">PDF</span>
              </button>
              <button
                onClick={exportProductsExcel}
                // Verde do Excel: o botão se reconhece pela cor antes do texto.
                className="px-4 py-2 rounded-xl flex items-center gap-2 text-xs tracking-widest uppercase font-black whitespace-nowrap border-2 text-white bg-[#16a34a] border-[#15803d] hover:bg-[#15803d] transition-colors"
                title="Exportar lista filtrada em CSV/Excel"
              >
                <FileSpreadsheet size={18} />
                <span>Excel</span>
              </button>
            </>
          )}
          {!(subTab === 'equipe' && availableRoles.length === 0) && (
            <button
              onClick={() => {
                setEditingItem(null);
                setFormData({});
                if (subTab === 'categorias') {
                  setCatForm({
                    id: 'C-' + crypto.randomUUID(),
                    name: '',
                    color: '#3b82f6',
                    pdvMode: nichoFilter,
                    active: true,
                  });
                }
                if (subTab === 'equipe') setShowAddUser(true);
                if (subTab === 'clientes') {
                  setFormData({ type: 'PF' });
                  setShowAddClient(true);
                }
                if (subTab === 'produtos') {
                  // Pré-preenche o nicho com o filtro atual (fica coerente com
                  // o que o operador está vendo). 'todos' cai em supermax.
                  // atributosPadrao entra com o que já tem resposta óbvia
                  // (garantia mínima do CDC em TechMax) — continua editável.
                  setFormData({ pdvMode: nichoFilter, atributos: atributosPadrao(nichoFilter) });
                  setFichaOutro(new Set());
                  setMarginDraft(null);
                  setShowAddProduct(true);
                }
                if (subTab === 'servicos') {
                  setFormData({ pdvMode: nichoFilter });
                  setShowAddService(true);
                }
                if (subTab === 'fornecedores') {
                  setFormData({ type: 'PF' });
                  setShowAddSupplier(true);
                }
              }}
              className="bg-[var(--accent)] text-black font-black px-6 py-2 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform active:scale-95 whitespace-nowrap shadow-lg text-xs tracking-widest uppercase shimmer border-2 border-[var(--accent-dark)]"
            >
              <Plus size={20} className="relative z-[2]" />
              <span className="relative z-[2]">NOVO</span>
            </button>
          )}
        </div>
      </div>

      {showAddUser && subTab === 'equipe' && (() => {
        const fechar = () => {
          setShowAddUser(false);
          setEditingItem(null);
          setFormData({});
          setNewUser({ name: '', email: '', password: '', role: '' as UserRole });
        };
        return (
        <div className="fixed inset-0 min-h-screen z-[80] overflow-y-auto bg-black/70 backdrop-blur-md animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-8 animate-in slide-in-from-top duration-300 max-w-2xl w-full my-8">
          <CabecalhoForm titulo={editingItem ? 'Editar membro' : 'Novo membro da equipe'} onFechar={fechar} />

          <form onSubmit={handleAddUser}>
            <section className="fc-section">
              <h4 className="fc-section-title"><Shield size={18} /> Acesso ao sistema</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="fc-label">Nome completo<Obrigatorio /></label>
                  <div className="neumorphic-inset px-3 py-2.5 flex items-center gap-2">
                    <UserIcon size={16} className="text-gray-500 shrink-0" />
                    <input
                      type="text" required value={newUser.name}
                      onChange={e => setNewUser({...newUser, name: e.target.value})}
                      placeholder="Ex.: Maria Souza"
                      className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-medium"
                    />
                  </div>
                </div>
                <div className={`space-y-1.5 ${editingItem ? 'md:col-span-2' : ''}`}>
                  <label className="fc-label">E-mail de acesso<Obrigatorio /></label>
                  <div className="neumorphic-inset px-3 py-2.5 flex items-center gap-2">
                    <Mail size={16} className="text-gray-500 shrink-0" />
                    <input
                      type="email" required value={newUser.email}
                      onChange={e => setNewUser({...newUser, email: e.target.value})}
                      placeholder="nome@empresa.com"
                      className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-medium"
                    />
                  </div>
                </div>
                {!editingItem && (
                  <div className="space-y-1.5">
                    <label className="fc-label">Senha temporária<Obrigatorio /></label>
                    <div className="neumorphic-inset px-3 py-2.5 flex items-center gap-2">
                      <Lock size={16} className="text-gray-500 shrink-0" />
                      <input
                        type={senhaVisivel ? 'text' : 'password'} required value={newUser.password}
                        onChange={e => setNewUser({...newUser, password: e.target.value})}
                        className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-medium"
                        style={senhaVisivel ? { fontFamily: 'Consolas, "Courier New", monospace', letterSpacing: '0.05em' } : undefined}
                      />
                      {/* Quem cadastra esta INVENTANDO a senha e vai dita-la ao
                          operador — ver o que digitou nao e conveniencia, e o que
                          evita entregar uma senha com typo que ninguem consegue
                          usar depois. Monoespacado ao revelar, porque a duvida
                          costuma ser entre l/I/1 e O/0. */}
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setSenhaVisivel(v => !v)}
                        className="text-gray-500 hover:text-gray-900 transition-colors shrink-0"
                        title={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
                        aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
                      >
                        {senhaVisivel ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="fc-label">Cargo<Obrigatorio /></label>
                  <div className="neumorphic-inset px-3 py-2.5 flex items-center gap-2 relative">
                    <Shield size={16} className="text-gray-500 shrink-0" />
                    <select
                      required value={newUser.role}
                      onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}
                      className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-medium appearance-none pr-6 cursor-pointer"
                    >
                      <option value="">Selecione o cargo</option>
                      {availableRoles.map(role => (
                        <option key={role} value={role}>{ROLE_LABELS[role] ?? role.replace('_', ' ')}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="text-gray-500 absolute right-3 pointer-events-none" />
                  </div>
                </div>
                {/* Empresas — so na EDICAO e so para Operador de Caixa.
                    No cadastro nao aparece porque a empresa e a que esta aberta na
                    tela; e para gestao nao faz sentido, ja que admin_master e ceo
                    operam as tres por definicao do cargo (o trigger
                    aplica_lojas_por_cargo sobrescreveria qualquer escolha). */}
                {editingItem && newUser.role === 'operador_caixa' && (
                  <div className="space-y-2 md:col-span-2">
                    <label className="fc-label">Empresas em que opera</label>
                    <div className="flex flex-wrap gap-3">
                      {(['supermax', 'maxlook', 'techmax'] as const).map(f => {
                        const m = FILIAL_META[f];
                        const marcada = lojasForm.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setLojasForm(prev =>
                              prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f],
                            )}
                            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 transition-all active:scale-95"
                            style={{
                              borderColor: marcada ? 'var(--accent)' : 'rgb(255 255 255 / 0.3)',
                              background: marcada ? 'rgb(255 255 255 / 0.12)' : 'transparent',
                            }}
                            aria-pressed={marcada}
                          >
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
                              style={{ background: m.plate }}
                            >
                              <img src={m.logo} alt="" className="w-6 h-6 object-contain" />
                            </span>
                            <span className="text-sm font-semibold text-white">{m.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="fc-hint">
                      A mesma pessoa pode atender mais de uma empresa. Ao entrar, quem tem
                      uma só vai direto para ela; quem tem mais escolhe no login.
                    </p>
                  </div>
                )}
              </div>
            </section>

            <RodapeForm rotulo={editingItem ? 'Salvar alterações' : 'Cadastrar membro'} onCancelar={fechar} />
          </form>
          </div>
        </div>
        );
      })()}

      {showAddClient && subTab === 'clientes' && renderFormPessoa('cliente')}

      {showAddProduct && subTab === 'produtos' && (() => {
        // Empresa e a da SESSAO, nao uma escolha do formulario: escolher aqui
        // permitia cadastrar produto na MaxLook estando dentro da TechMax.
        // Por isso agora e so um chip ao lado do titulo, nao mais um campo.
        const pdvAlvo = (editingItem?.pdvMode ?? nichoFilter) as keyof typeof FILIAL_META;
        const meta = FILIAL_META[pdvAlvo];
        const temMarca = pdvAlvo !== 'supermax';
        const unidadeLivre = pdvAlvo === 'supermax';
        const fichaDefs = ATRIBUTOS_PRODUTO[pdvAlvo] ?? [];
        const setAtributo = (key: string, valor: string) =>
          setFormData({ ...formData, atributos: { ...(formData.atributos ?? {}), [key]: valor } });
        const fechar = () => { setShowAddProduct(false); setEditingItem(null); setFormData({}); };
        return (
        <div className="fixed inset-0 min-h-screen z-[80] overflow-y-auto bg-black/70 backdrop-blur-md animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-8 animate-in slide-in-from-top duration-300 max-w-6xl w-full my-8">
          <CabecalhoForm titulo={editingItem ? 'Editar produto' : 'Novo produto'} filial={pdvAlvo} onFechar={fechar} />

          {/* Coluna lateral com a foto só no desktop; no celular ela desce
              para o fim, que é onde já ficava — é o campo mais raro de mudar. */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              <section className="fc-section">
                <h4 className="fc-section-title"><Tag size={18} /> Identificação</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="fc-label">
                      Nome do produto <span className="text-red-600">*</span>
                    </label>
                    <input
                      value={formData.name || ''}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ex.: Arroz Branco Camil 5kg"
                      className={CAMPO}
                      autoFocus
                    />
                  </div>

                  {/* REF: o codigo curto que o operador digita no caixa. Nao existia
                      campo nenhum, entao todo produto novo nascia sem ele e so podia
                      ser chamado pelo nome ou pelo EAN. */}
                  <div className="space-y-1.5">
                    <label className="fc-label">Código / REF</label>
                    <input
                      value={formData.ref || ''}
                      onChange={e => setFormData({ ...formData, ref: e.target.value })}
                      placeholder="Ex.: arroz, 4011, CX-102"
                      className={CAMPO}
                    />
                    <p className="fc-hint">
                      Código curto digitado no PDV para chamar o produto sem leitor.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="fc-label">Categoria</label>
                    <select
                      value={formData.category || ''}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                      className={`${CAMPO} appearance-none`}
                    >
                      <option value="">Sem categoria</option>
                      {opcoesCategoria(pdvAlvo).map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                      {/* Valor antigo que não existe mais no cadastro continua
                          selecionável, senão editar o produto o apagaria em silêncio. */}
                      {formData.category && !opcoesCategoria(pdvAlvo).some(c => c.name === formData.category) && (
                        <option value={formData.category}>{String(formData.category)} (fora do cadastro)</option>
                      )}
                    </select>
                    {opcoesCategoria(pdvAlvo).length === 0 && (
                      <p className="fc-hint">
                        Nenhuma categoria cadastrada — crie em <b>Cadastros → Categorias</b>.
                      </p>
                    )}
                  </div>

                  {/* Marca so faz sentido em quem revende grife/fabricante — no
                      SuperMax o card do PDV nem desenha esse badge. */}
                  {temMarca && (
                    <div className="space-y-1.5">
                      <label className="fc-label">
                        Marca <span className="font-normal">(opcional)</span>
                      </label>
                      <input
                        value={formData.marca || ''}
                        onChange={e => setFormData({ ...formData, marca: e.target.value })}
                        placeholder={pdvAlvo === 'maxlook' ? 'Ex.: Hering, Colcci, Vans...' : 'Ex.: Samsung, Lenovo, JBL...'}
                        className={CAMPO}
                      />
                      <p className="fc-hint">Aparece como destaque no card do produto no PDV.</p>
                    </div>
                  )}

                  <div className={`space-y-1.5 ${temMarca ? '' : 'md:col-span-2'}`}>
                    <label className="fc-label">Código de barras (EAN-13)</label>
                    <div className="flex gap-2">
                      <input
                        value={formData.ean13 || ''}
                        onChange={e => setFormData({ ...formData, ean13: e.target.value.replace(/\D/g, '').slice(0, 13) })}
                        placeholder="13 dígitos"
                        inputMode="numeric"
                        className={`${CAMPO} flex-1 min-w-0 font-mono`}
                      />
                      {/* Gerar existia só dentro do modal de etiqueta; aqui o
                          operador digitava à mão e um dígito verificador errado só
                          aparecia depois, ao imprimir. */}
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, ean13: generateEAN13() })}
                        className="smart-btn-secondary !py-2 !px-3 !text-sm shrink-0"
                      >
                        <Barcode size={16} /> Gerar
                      </button>
                    </div>
                    {formData.ean13 && !isValidEAN13(String(formData.ean13)) && (
                      <p className="text-xs font-semibold text-red-600">
                        EAN-13 inválido — confira os 13 dígitos e o verificador, ou use Gerar.
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Ficha do nicho (JSONB em products.atributos) — só MaxLook e
                  TechMax têm. SuperMax não desenha nada aqui. */}
              {fichaDefs.length > 0 && (
                <section className="fc-section">
                  <h4 className="fc-section-title"><ListChecks size={18} /> Ficha {meta.label}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {fichaDefs.map(d => {
                      const valor = String((formData.atributos as any)?.[d.key] ?? '');
                      const wideCls = d.wide ? 'md:col-span-2' : '';
                      if (d.type === 'select' && d.options) {
                        const naLista = (d.options as readonly string[]).includes(valor);
                        const OUTRO = '__outro__';
                        // O modo "Outro" mora no Set `fichaOutro`, não no valor
                        // do campo: se dependesse só de "valor não vazio e fora
                        // da lista", escolher Outro e ainda não ter digitado
                        // nada devolvia o select pra "Selecione" sozinho.
                        const emOutro = !!d.livre && (fichaOutro.has(d.key) || (valor !== '' && !naLista));
                        return (
                          <div key={d.key} className={`space-y-1.5 ${wideCls}`}>
                            <label className="fc-label">
                              {d.label} {d.req && <span className="text-red-600">*</span>}
                            </label>
                            <select
                              value={emOutro ? OUTRO : valor}
                              onChange={e => {
                                if (e.target.value === OUTRO) {
                                  setFichaOutro(prev => new Set(prev).add(d.key));
                                  setAtributo(d.key, '');
                                  return;
                                }
                                setFichaOutro(prev => {
                                  if (!prev.has(d.key)) return prev;
                                  const n = new Set(prev); n.delete(d.key); return n;
                                });
                                setAtributo(d.key, e.target.value);
                              }}
                              className={`${CAMPO} appearance-none`}
                            >
                              <option value="">Selecione</option>
                              {d.options.map(o => <option key={o} value={o}>{o}</option>)}
                              {d.livre && <option value={OUTRO}>Outro…</option>}
                            </select>
                            {emOutro && (
                              <input
                                autoFocus
                                value={valor}
                                onChange={e => setAtributo(d.key, e.target.value)}
                                placeholder="Digite o valor"
                                className={CAMPO}
                              />
                            )}
                            {d.dica && <p className="fc-hint">{d.dica}</p>}
                          </div>
                        );
                      }
                      if (d.type === 'textarea') {
                        return (
                          <div key={d.key} className={`space-y-1.5 ${wideCls}`}>
                            <label className="fc-label">{d.label}</label>
                            <textarea
                              rows={3}
                              value={valor}
                              onChange={e => setAtributo(d.key, e.target.value)}
                              placeholder={d.placeholder}
                              className={`${CAMPO} resize-none`}
                            />
                          </div>
                        );
                      }
                      return (
                        <div key={d.key} className={`space-y-1.5 ${wideCls}`}>
                          <label className="fc-label">
                            {d.label} {d.req && <span className="text-red-600">*</span>}
                          </label>
                          <input
                            value={valor}
                            inputMode={d.soDigitos ? 'numeric' : undefined}
                            onChange={e => setAtributo(d.key, d.soDigitos ? e.target.value.replace(/\D/g, '') : e.target.value)}
                            placeholder={d.placeholder}
                            className={CAMPO}
                          />
                          {d.dica && <p className="fc-hint">{d.dica}</p>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="fc-section">
                <h4 className="fc-section-title"><CircleDollarSign size={18} /> Preço</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <label className="fc-label">Preço de custo (R$)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={maskCurrency(Math.round((formData.costPrice || 0) * 100))}
                      onChange={e => {
                        const custo = parseCurrencyToNumber(e.target.value);
                        // Preenche a venda sozinho SÓ quando ela ainda está vazia.
                        // Sugestão não sobrescreve decisão: quem já digitou um preço
                        // tem um motivo, e ver o número mudar sob os dedos é a pior
                        // forma de "ajudar". Com preço já posto, a sugestão vira o
                        // aviso abaixo do campo, que a pessoa aplica se quiser.
                        const alvo = markupAlvoDaCategoria;
                        const precoAtual = Number(formData.price || 0);
                        const price = (alvo != null && custo > 0 && precoAtual === 0)
                          ? Math.round(custo * (1 + alvo / 100) * 100) / 100
                          : formData.price;
                        setFormData({ ...formData, costPrice: custo, price });
                      }}
                      className={`${CAMPO} !font-bold !text-red-700`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="fc-label">
                      Preço de venda (R$) <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={maskCurrency(Math.round((formData.price || 0) * 100))}
                      onChange={e => setFormData({ ...formData, price: parseCurrencyToNumber(e.target.value) })}
                      className={`${CAMPO} !font-bold !text-[var(--money)]`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="fc-label" title="Quanto da VENDA é lucro. Digitar recalcula o preço de venda.">Margem (%)</label>
                    {(() => {
                      const custo = Number(formData.costPrice || 0);
                      const preco = Number(formData.price || 0);
                      const calculada = preco && custo ? (((preco - custo) / preco) * 100).toFixed(2) : '';
                      return (
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!custo}
                          value={marginDraft ?? calculada}
                          onFocus={() => setMarginDraft(calculada)}
                          onChange={e => setMarginDraft(e.target.value)}
                          onBlur={() => {
                            const margem = parseFloat((marginDraft ?? '').replace(',', '.'));
                            // Margem >= 100 pediria preço infinito ou negativo —
                            // ignora e volta pro valor calculado a partir do preço.
                            if (Number.isFinite(margem) && custo > 0 && margem < 100) {
                              const novoPreco = Math.round((custo / (1 - margem / 100)) * 100) / 100;
                              setFormData({ ...formData, price: novoPreco });
                            }
                            setMarginDraft(null);
                          }}
                          placeholder={custo ? '0.00' : 'Informe o custo'}
                          className={`${CAMPO} disabled:cursor-not-allowed`}
                        />
                      );
                    })()}
                  </div>

                  {/* Markup andava faltando: margem e markup respondem perguntas
                      diferentes e o pessoal de compra raciocina em markup ("multiplico
                      o custo por quanto?"), não em margem. Custo 10 / venda 20 é 50%
                      de margem E 100% de markup — sem os dois lado a lado, era fácil
                      digitar um no campo do outro e errar o preço pra baixo. */}
                  <div className="space-y-1.5">
                    <label className="fc-label" title="Quanto se soma ao CUSTO. Digitar recalcula o preço de venda.">Markup (%)</label>
                    {(() => {
                      const custo = Number(formData.costPrice || 0);
                      const preco = Number(formData.price || 0);
                      const calculado = preco && custo ? (((preco - custo) / custo) * 100).toFixed(2) : '';
                      return (
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!custo}
                          value={markupDraft ?? calculado}
                          onFocus={() => setMarkupDraft(calculado)}
                          onChange={e => setMarkupDraft(e.target.value)}
                          onBlur={() => {
                            const markup = parseFloat((markupDraft ?? '').replace(',', '.'));
                            // Markup <= -100 daria preço zero ou negativo — ignora e
                            // volta pro valor calculado a partir do preço atual.
                            if (Number.isFinite(markup) && custo > 0 && markup > -100) {
                              const novoPreco = Math.round(custo * (1 + markup / 100) * 100) / 100;
                              setFormData({ ...formData, price: novoPreco });
                            }
                            setMarkupDraft(null);
                          }}
                          placeholder={custo ? '0.00' : 'Informe o custo'}
                          className={`${CAMPO} disabled:cursor-not-allowed`}
                        />
                      );
                    })()}
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  <p className="fc-hint">
                    Margem é quanto da <b>venda</b> é lucro; markup é quanto se soma ao <b>custo</b>. Os dois são editáveis e recalculam o preço de venda.
                  </p>
                  {markupAlvoDaCategoria != null && (
                    <p className="fc-hint">
                      Categoria com markup-alvo de <strong>{markupAlvoDaCategoria}%</strong> — a venda é sugerida a partir do custo.
                    </p>
                  )}
                  {/* Só aparece quando a sugestão DIVERGE do que está no campo —
                      repetir um número igual ao que já está ali é ruído. */}
                  {precoSugerido != null && precoSugerido !== Number(formData.price || 0) && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, price: precoSugerido })}
                      className="text-xs font-semibold underline underline-offset-2 hover:opacity-80"
                      style={{ color: 'var(--accent)' }}
                    >
                      Aplicar sugestão da categoria: R$ {precoSugerido.toFixed(2).replace('.', ',')}
                    </button>
                  )}
                </div>
              </section>

              <section className="fc-section">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h4 className="fc-section-title !mb-0"><Boxes size={18} /> Estoque</h4>
                  {editingItem && (
                    <button
                      type="button"
                      onClick={() => setStockModal({ isOpen: true, product: formData, action: 'sum', amount: 0 })}
                      className="text-sm font-semibold underline underline-offset-2 hover:opacity-80"
                      style={{ color: 'var(--accent)' }}
                    >
                      Editar estoque
                    </button>
                  )}
                </div>

                {/* items-start: a dica embaixo do "Estoque atual" deixa aquela
                    célula mais alta, e alinhando pelo fim os campos vizinhos
                    desciam junto. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                  {/* Uma entrada só pra estoque: cadastro novo digita o saldo
                      inicial; produto existente mostra o saldo — editável só pelo
                      Admin Master, que corrige o número direto; para os demais
                      qualquer ajuste passa por "Editar estoque" (soma/subtrai/
                      corrige) em vez de escrever em cima do saldo. */}
                  {editingItem ? (
                    <div className="space-y-1.5">
                      <label className="fc-label">Estoque atual</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!podeEditarEstoqueDireto}
                        value={formData.stock ?? 0}
                        onChange={e => {
                          if (!podeEditarEstoqueDireto) return;
                          // Saldo negativo trava a venda no PDV e na
                          // finalize_sale_atomic — mesmo piso do modal de ajuste.
                          const n = parseInt(e.target.value, 10);
                          setFormData({ ...formData, stock: Number.isFinite(n) ? Math.max(0, n) : 0 });
                        }}
                        className={`${CAMPO} ${podeEditarEstoqueDireto ? '' : 'cursor-not-allowed'}`}
                      />
                      <p className="fc-hint">
                        {podeEditarEstoqueDireto
                          ? 'Corrige o saldo direto. Para entrada de mercadoria, prefira "Editar estoque".'
                          : 'Somente leitura. Use "Editar estoque" para somar, subtrair ou corrigir.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="fc-label">Estoque inicial</label>
                      <input
                        type="number"
                        value={formData.stock || ''}
                        onChange={e => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                        className={CAMPO}
                        placeholder="0"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="fc-label">Estoque mínimo</label>
                    <input
                      type="number"
                      value={formData.minStock || ''}
                      onChange={e => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                      className={CAMPO}
                      placeholder="0"
                    />
                  </div>

                  {/* Unidade so e uma escolha real no SuperMax — hortifruti pesa,
                      bebida mede em litro. MaxLook e TechMax vendem sempre por
                      unidade, e o select de KG/M²/CX so confundia quem cadastra
                      tênis ou celular. */}
                  <div className="space-y-1.5">
                    <label className="fc-label">Unidade de medida</label>
                    {unidadeLivre ? (
                      <select
                        value={formData.unit || 'UN'}
                        onChange={e => setFormData({ ...formData, unit: e.target.value })}
                        className={`${CAMPO} appearance-none`}
                      >
                        <option value="UN">Unidade (UN)</option>
                        <option value="KG">Quilograma (KG)</option>
                        <option value="LT">Litro (LT)</option>
                        <option value="MT">Metro (MT)</option>
                        <option value="M2">Metro quadrado (M²)</option>
                        <option value="CM">Centímetro (CM)</option>
                        <option value="CX">Caixa (CX)</option>
                        <option value="PCT">Pacote (PCT)</option>
                      </select>
                    ) : (
                      <div className={CAMPO} aria-disabled="true">Unidade (UN)</div>
                    )}
                  </div>
                </div>

                <label className="mt-4 inline-flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.controlStock === false}
                    onChange={e => setFormData({ ...formData, controlStock: !e.target.checked })}
                  />
                  <span className="text-sm font-medium text-white">Não controlar estoque deste produto</span>
                </label>
              </section>
            </div>

            <aside className="fc-section space-y-3">
              <h4 className="fc-section-title !mb-1"><ImageIcon size={18} /> Imagem</h4>
              <div className="flex flex-col sm:flex-row lg:flex-col gap-4 items-center sm:items-start lg:items-stretch">
              <div className="aspect-square w-40 sm:w-32 lg:w-full lg:max-w-[14rem] lg:mx-auto shrink-0 rounded-xl bg-white flex items-center justify-center overflow-hidden border-2" style={{ borderColor: 'var(--accent)' }}>
                {formData.image ? (
                  <img src={formData.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Package size={48} className="text-gray-300" />
                )}
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleProductImage}
                className="hidden"
              />
              <div className="flex flex-col gap-2 w-full sm:flex-1 lg:flex-none">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={processandoImagem}
                  className="smart-btn-secondary !py-2 !text-sm w-full disabled:opacity-60 disabled:cursor-wait"
                >
                  <Upload size={16} />
                  {processandoImagem ? 'Otimizando…' : formData.image ? 'Trocar imagem' : 'Escolher imagem'}
                </button>
                <ColarImagem
                  onImagem={processarImagemProduto}
                  disabled={processandoImagem}
                  className="justify-center w-full !py-2"
                />
                {formData.image && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, image: undefined, vitrine: false })}
                    className="smart-btn-danger !py-2 !text-sm w-full inline-flex items-center justify-center gap-2"
                  >
                    <CloseIcon size={16} /> Remover
                  </button>
                )}
              </div>
              </div>
              <p className="fc-hint">
                JPG, PNG ou WEBP de até <b>{IMAGEM_MAX_ENTRADA_LABEL}</b>; o sistema reduz sozinho antes de salvar.
                Também dá para copiar uma imagem e colar com Ctrl+V. Sem imagem, o produto exibe um ícone padrão.
              </p>
              {(() => {
                // Mesma régua da tela Vitrine: só produto COM FOTO entra (o
                // carrossel não tem o que desenhar sem imagem), e o teto de
                // 12 por empresa é o que a RPC pública aceita.
                const naVitrineCount = products.filter(p =>
                  (p.pdvMode ?? 'supermax') === pdvAlvo && p.vitrine && p.id !== editingItem?.id).length;
                const semFoto = !formData.image;
                const vitrineCheia = !formData.vitrine && naVitrineCount >= LIMITE_VITRINE;
                const bloqueado = semFoto || vitrineCheia;
                return (
                  <div className="pt-3 border-t border-gray-200">
                    <label className={`flex items-start gap-3 ${bloqueado ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={!!formData.vitrine}
                        disabled={bloqueado}
                        onChange={e => setFormData({ ...formData, vitrine: e.target.checked })}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="text-sm font-medium text-white select-none">
                        Exibir na vitrine
                        <span className="block fc-hint">Carrossel da tela de login</span>
                      </span>
                    </label>
                    {semFoto && (
                      <p className="fc-hint mt-1.5">Precisa de imagem para entrar na vitrine.</p>
                    )}
                    {vitrineCheia && (
                      <p className="text-xs text-amber-600 mt-1.5">Vitrine cheia ({LIMITE_VITRINE}) nesta empresa — tire um produto em Vitrine antes de adicionar outro.</p>
                    )}
                  </div>
                );
              })()}
            </aside>
          </div>

          <RodapeForm
            rotulo={editingItem ? 'Salvar alterações' : 'Salvar produto'}
            onCancelar={fechar}
            onSalvar={() => handleSave('produto')}
          />
          </div>
        </div>
        );
      })()}

      {showAddService && subTab === 'servicos' && (() => {
        // Empresa da sessao — ver a mesma nota no formulario de produto.
        const pdvAlvo = (editingItem?.pdvMode ?? nichoFilter) as keyof typeof FILIAL_META;
        const fechar = () => { setShowAddService(false); setEditingItem(null); setFormData({}); };
        const custo = Number(formData.costPrice || 0);
        const preco = Number(formData.price || 0);
        const margem = preco && custo ? (((preco - custo) / preco) * 100).toFixed(1).replace('.', ',') + '%' : '—';
        return (
        <div className="fixed inset-0 min-h-screen z-[80] overflow-y-auto bg-black/70 backdrop-blur-md animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-8 animate-in slide-in-from-top duration-300 max-w-4xl w-full my-8">
          <CabecalhoForm titulo={editingItem ? 'Editar serviço' : 'Novo serviço'} filial={pdvAlvo} onFechar={fechar} />

          <div className="space-y-5">
            <section className="fc-section">
              <h4 className="fc-section-title"><Tag size={18} /> Identificação</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="fc-label">Nome do serviço<Obrigatorio /></label>
                  <input
                    value={formData.name || ''}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex.: Troca de tela, instalação..."
                    className={CAMPO}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="fc-label">Categoria</label>
                  <select
                    value={formData.category || ''}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    className={`${CAMPO} appearance-none`}
                  >
                    <option value="">Sem categoria</option>
                    {opcoesCategoria(pdvAlvo).map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                    {formData.category && !opcoesCategoria(pdvAlvo).some(c => c.name === formData.category) && (
                      <option value={formData.category}>{String(formData.category)} (fora do cadastro)</option>
                    )}
                  </select>
                </div>
              </div>
            </section>

            <section className="fc-section">
              <h4 className="fc-section-title"><CircleDollarSign size={18} /> Preço</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                <div className="space-y-1.5">
                  <label className="fc-label">Preço de custo (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maskCurrency(Math.round((formData.costPrice || 0) * 100))}
                    onChange={e => setFormData({ ...formData, costPrice: parseCurrencyToNumber(e.target.value) })}
                    className={`${CAMPO} !font-bold !text-red-700`}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="fc-label">Preço de venda (R$)<Obrigatorio /></label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maskCurrency(Math.round((formData.price || 0) * 100))}
                    onChange={e => setFormData({ ...formData, price: parseCurrencyToNumber(e.target.value) })}
                    className={`${CAMPO} !font-bold !text-[var(--money)]`}
                  />
                </div>
                {/* Calculada, nao digitada: aparece como resultado, nao como
                    campo — um input branco igual aos outros convidava a clicar. */}
                <div className="space-y-1.5">
                  <span className="fc-label">Margem de lucro</span>
                  <p className="text-2xl font-bold text-white leading-[2.75rem] tabular-nums">{margem}</p>
                </div>
              </div>
            </section>

            <section className="fc-section">
              <h4 className="fc-section-title"><FileText size={18} /> Informações adicionais</h4>
              <textarea
                value={formData.additionalInfo || ''}
                onChange={e => setFormData({ ...formData, additionalInfo: e.target.value })}
                rows={3}
                className={`${CAMPO} resize-none`}
                placeholder="Detalhes sobre o serviço, prazos etc."
              />
            </section>
          </div>

          <RodapeForm
            rotulo={editingItem ? 'Salvar alterações' : 'Salvar serviço'}
            onCancelar={fechar}
            onSalvar={() => handleSave('servico')}
          />
          </div>
        </div>
        );
      })()}

      {showAddSupplier && subTab === 'fornecedores' && renderFormPessoa('fornecedor')}

      {/* Formulário de categoria — inline, acima da lista. Cadastro de três
          campos não justifica um modal por cima da tela. */}
      {catForm && subTab === 'categorias' && (
        <div className="neumorphic neumorphic-accent p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <FolderTree size={18} style={{ color: 'var(--navy)' }} />
            <h3 className="text-base font-black uppercase tracking-wide" style={{ color: 'var(--navy)' }}>
              {categories.some(c => c.id === catForm.id) ? 'Editar categoria' : 'Nova categoria'}
            </h3>
          </div>
          {/* A foto ajuda a achar a categoria de relance, que é o que se faz
              numa lista longa. Mesmo componente de cliente e fornecedor: o
              navegador reduz antes de subir. */}
          <CampoFoto
            nome={catForm.name}
            image={catForm.image}
            onChange={img => setCatForm({ ...catForm, image: img })}
            onErro={showAlert}
          />
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-600">Nome</label>
              <input
                autoFocus
                value={catForm.name}
                onChange={e => setCatForm({ ...catForm, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') salvarCategoria(); if (e.key === 'Escape') setCatForm(null); }}
                placeholder="Ex.: Mercearia, Hortifruti, Limpeza"
                className="px-3 py-2 rounded-lg border-2 outline-none focus:border-blue-700 bg-white text-sm font-bold"
                style={{ borderColor: 'var(--border-strong)' }}
              />
            </div>
            {/* O seletor de empresa saiu daqui em 2026-09-19e. Ele permitia,
                operando na SuperMax, criar categoria para a MaxLook — e a
                empresa é o CONTEXTO da sessão em todo o resto do sistema, não
                um campo de formulário. Agora a categoria nasce na empresa em
                que se está, e a tela apenas informa qual é. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-600">Empresa</label>
              <div
                className="px-3 py-2 rounded-lg border-2 text-sm font-black flex items-center gap-2"
                style={{
                  background: FILIAL_META[nichoFilter].color,
                  color: FILIAL_META[nichoFilter].fg,
                  borderColor: FILIAL_META[nichoFilter].dark,
                }}
                title="A categoria pertence à empresa em que você está operando"
              >
                {FILIAL_META[nichoFilter].label}
              </div>
            </div>
            {/* Markup-alvo: o que a empresa QUER ganhar nesta categoria. Não
                trava preço nenhum — o cadastro de produto usa isso para sugerir
                a venda assim que o custo é digitado, para quem cadastra não ter
                de fazer a conta de cabeça (e errar para baixo). */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-600">
                Markup-alvo (%)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={catForm.markupAlvo ?? ''}
                onChange={e => {
                  const v = e.target.value.replace(',', '.').trim();
                  const n = parseFloat(v);
                  setCatForm({ ...catForm, markupAlvo: v === '' || !Number.isFinite(n) || n < 0 ? undefined : n });
                }}
                placeholder="Ex.: 40"
                title="Sobre o CUSTO. Custo 10 com markup 100% sugere venda 20."
                className="w-28 px-3 py-2 rounded-lg border-2 outline-none focus:border-blue-700 bg-white text-sm font-bold"
                style={{ borderColor: 'var(--border-strong)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-600">Cor</label>
              <div className="flex gap-1.5">
                {['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#f59e0b', '#6b7280'].map(hex => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setCatForm({ ...catForm, color: hex })}
                    title={hex}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      background: hex,
                      borderColor: catForm.color === hex ? 'var(--navy)' : 'rgba(0,0,0,0.15)',
                      boxShadow: catForm.color === hex ? '0 0 0 2px var(--accent)' : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700 pb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={catForm.active}
                onChange={e => setCatForm({ ...catForm, active: e.target.checked })}
                className="w-4 h-4 cursor-pointer"
              />
              Ativa
            </label>
            <div className="flex gap-2 pb-0.5 ml-auto">
              <button
                onClick={() => setCatForm(null)}
                className="px-4 py-2 rounded-lg border-2 text-sm font-black uppercase tracking-wider hover:bg-gray-50"
                style={{ borderColor: 'var(--border-strong)', color: '#374151' }}
              >Cancelar</button>
              <button
                onClick={salvarCategoria}
                disabled={catSaving}
                className="px-5 py-2 rounded-lg border-2 text-sm font-black uppercase tracking-wider text-white disabled:opacity-40"
                style={{ background: 'var(--navy)', borderColor: 'var(--accent)' }}
              >{catSaving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
          {/* Renomear mexe nos produtos: o operador precisa saber antes. */}
          {categories.some(c => c.id === catForm.id && c.name !== catForm.name.trim()) && (
            <p className="text-xs font-bold" style={{ color: 'var(--accent-dark)' }}>
              Renomear atualiza também os produtos e serviços que usam esta categoria.
            </p>
          )}
        </div>
      )}

      <div className="neumorphic flex flex-col min-h-[480px] relative">
        {/* @container: as colunas opcionais precisam responder a largura DESTE
            box, nao a da janela. Com breakpoint de viewport, uma tela de 1280
            (onde `xl:` ja vale) dava so ~966px de tabela depois da sidebar — a
            Margem aparecia, a tabela estourava e a coluna Estoque ficava
            escondida embaixo de Acoes, que e sticky. */}
        <div className="@container overflow-x-auto flex-1 custom-scrollbar scroll-smooth">
          {/* Enquanto carrega, linhas fantasma no lugar da tabela vazia. Esta
              tela era a unica sem NENHUM indicador: o operador via um retangulo
              branco e nao sabia se estava carregando ou se o cadastro estava
              vazio de verdade. */}
          {loading ? (
            <div className="p-5 flex flex-col gap-3" aria-busy="true" aria-live="polite">
              <span className="sr-only">Carregando cadastros…</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className="skeleton" style={{ width: '3rem', height: '3rem', borderRadius: '0.5rem' }} aria-hidden="true">&nbsp;</span>
                  <span className="skeleton flex-1" style={{ height: '1rem', maxWidth: `${58 - i * 4}%` }} aria-hidden="true">&nbsp;</span>
                  <span className="skeleton" style={{ width: '5rem', height: '1rem' }} aria-hidden="true">&nbsp;</span>
                  <span className="skeleton" style={{ width: '4rem', height: '1rem' }} aria-hidden="true">&nbsp;</span>
                </div>
              ))}
            </div>
          ) : renderTable()}
        </div>
        
        {/* Barcode Modal */}
        {barcodeModal.isOpen && (
          <div className="fixed inset-0 min-h-screen z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm print:bg-white print:p-0">
            <div className="bg-white max-w-md w-full border-2 border-gray-300 shadow-2xl relative print:shadow-none print:border-0 print:m-0">
              {/* Header navy */}
              <div className="px-5 py-3 flex items-center justify-between text-white print:hidden" style={{ background: 'var(--navy)' }}>
                <h3 className="text-base font-black uppercase tracking-wide">Etiqueta do Produto</h3>
                <button
                  onClick={() => setBarcodeModal({ isOpen: false, product: null })}
                  className="text-white hover:opacity-70"
                >
                  <CloseIcon size={22} />
                </button>
              </div>

              <div className="p-6 space-y-5 print:p-0 print:mt-10">
                <div className="text-center">
                  <p className="text-base font-bold text-gray-900 print:text-black">{barcodeModal.product?.name}</p>
                  {barcodeModal.product?.ref && (
                    <p className="text-sm text-gray-500 mt-0.5 print:hidden">REF: {barcodeModal.product.ref}</p>
                  )}
                </div>

                {/* Editor de EAN — escondido na impressão */}
                <div className="space-y-2 print:hidden">
                  <label className="smart-stat-label">Código EAN-13</label>
                  <div className="flex gap-2">
                    <input
                      value={eanInput}
                      onChange={e => setEanInput(e.target.value.replace(/\D/g, '').slice(0, 13))}
                      placeholder="13 dígitos (ex.: 7891234567895)"
                      className="smart-input flex-1 font-mono tabular-nums text-base"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={13}
                    />
                    <button
                      onClick={() => setEanInput(generateEAN13())}
                      className="smart-btn-secondary shrink-0"
                      title="Gerar EAN-13 válido aleatório"
                    >
                      GERAR
                    </button>
                  </div>
                  {eanInput.length === 0 ? (
                    <p className="text-xs text-gray-500">Digite ou gere um código EAN-13 para visualizar o código de barras.</p>
                  ) : !eanValid ? (
                    <p className="text-sm text-red-600 font-bold">
                      EAN-13 inválido — precisa ter 13 dígitos com check digit correto.
                    </p>
                  ) : eanDirty ? (
                    <p className="text-sm font-bold" style={{ color: 'var(--navy)' }}>
                      EAN válido. Clique em "Salvar no produto" para persistir.
                    </p>
                  ) : (
                    <p className="text-sm text-emerald-700 font-bold">EAN salvo no produto.</p>
                  )}
                </div>

                {/* Barcode visual */}
                <div className="bg-white p-5 border-2 border-gray-200 rounded flex justify-center min-h-[140px] items-center print:border-0 print:p-0">
                  {eanValid ? (
                    <svg ref={barcodeRef} className="max-w-full" />
                  ) : (
                    <div className="text-gray-400 text-sm text-center py-6 print:hidden">
                      Insira um EAN-13 válido para gerar o código de barras
                    </div>
                  )}
                </div>

                {/* Salvar EAN */}
                {eanValid && eanDirty && (
                  <button
                    onClick={saveEanToProduct}
                    disabled={savingEan}
                    className="smart-btn-primary w-full print:hidden disabled:opacity-50"
                  >
                    {savingEan ? 'SALVANDO...' : 'SALVAR EAN NO PRODUTO'}
                  </button>
                )}

                {/* Ações de exportação — só com EAN válido */}
                {eanValid && (
                  <div className="grid grid-cols-3 gap-2 print:hidden">
                    <button onClick={downloadBarcode} className="smart-btn-secondary">
                      <Download size={16} /> PNG
                    </button>
                    <button onClick={downloadPDF} className="smart-btn-secondary">
                      <Download size={16} /> PDF
                    </button>
                    <button onClick={printLabel} className="smart-btn-primary">
                      <Printer size={16} /> IMPRIMIR
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stock Adjustment Modal
            z-90: este modal SÓ abre de dentro do formulário de produto, que é
            z-80. Em z-70 ele nascia ATRÁS do formulário, coberto pelo backdrop
            escuro — o operador clicava em "Editar estoque" e a tela parecia não
            fazer nada. Os alertas (z-300) seguem por cima. */}
        {stockModal.isOpen && (
          <div className="fixed inset-0 min-h-screen z-[90] overflow-y-auto bg-black/70 backdrop-blur-md p-4 flex justify-center items-start animate-in fade-in duration-200">
            {(() => {
              const fechar = () => setStockModal({ isOpen: false, product: null, action: 'sum', amount: 0 });
              const saldo = Number(products.find(p => p.id === stockModal.product?.id)?.stock ?? stockModal.product?.stock ?? 0);
              const q = stockModal.amount || 0;
              const previsto = stockModal.action === 'sum' ? saldo + q : stockModal.action === 'subtract' ? saldo - q : q;
              const un = stockModal.product?.unit || 'UN';
              return (
                <div className="form-cadastro p-5 md:p-7 max-w-md w-full my-16 animate-in slide-in-from-top duration-300">
                  <CabecalhoForm titulo="Editar estoque" onFechar={fechar} />
                  <section className="fc-section space-y-4">
                    <p className="text-sm text-white font-semibold truncate">{stockModal.product?.name}</p>
                    <Segmentado
                      rotulo="Operação"
                      valor={stockModal.action}
                      opcoes={[
                        { valor: 'sum', rotulo: 'Entrada' },
                        { valor: 'subtract', rotulo: 'Baixa' },
                        { valor: 'correct', rotulo: 'Corrigir' },
                      ]}
                      onChange={action => setStockModal({ ...stockModal, action })}
                    />
                    <div className="space-y-1.5">
                      <label className="fc-label">
                        {stockModal.action === 'correct' ? 'Saldo correto' : 'Quantidade'} ({un})
                      </label>
                      <input
                        type="number"
                        min={0}
                        autoFocus
                        value={stockModal.amount || ''}
                        onChange={e => setStockModal({ ...stockModal, amount: Math.max(0, parseInt(e.target.value) || 0) })}
                        onKeyDown={e => { if (e.key === 'Enter') confirmStockAdjustment(); }}
                        className={`${CAMPO} !text-2xl !font-bold`}
                        placeholder="0"
                      />
                    </div>
                    {/* Mostra o resultado antes de gravar: é aqui que um
                        "Corrigir" digitado no lugar de "Entrada" se revela. */}
                    <div className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-3 tabular-nums">
                      <span className="fc-label">Saldo</span>
                      <span className="text-lg font-bold text-white">
                        {saldo} → <span className={previsto < 0 ? 'text-red-300' : ''}>{previsto}</span> {un}
                      </span>
                    </div>
                  </section>
                  <RodapeForm rotulo="Aplicar" onCancelar={fechar} onSalvar={confirmStockAdjustment} />
                </div>
              );
            })()}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 min-h-screen z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="aviso-card max-w-sm w-full animate-in zoom-in-95 duration-200" role="alertdialog" aria-modal="true">
              <div className="aviso-faixa" style={{ background: '#dc2626' }}>
                <span className="aviso-icone" style={{ color: '#dc2626' }}><Trash2 size={28} strokeWidth={2.4} /></span>
                {/* Pessoa nao e "excluida" desta tela: ela SAI DESTA EMPRESA.
                    Dizer "excluir" aqui seria mentira — ela continua operando
                    nas outras lojas dela. */}
                <h3 className="aviso-titulo">
                  {deleteConfirm.type === 'equipe' ? 'Remover da empresa?' : 'Excluir de vez?'}
                </h3>
              </div>
              <div className="aviso-corpo">
                {deleteConfirm.type === 'equipe' ? (
                  <p className="aviso-mensagem">
                    Tirar <strong>{deleteConfirm.name}</strong> da <strong>{FILIAL_META[nichoFilter].label}</strong>?
                    {'\n'}
                    <span className="text-sm text-gray-600">A conta continua ativa nas outras empresas em que ele opera.</span>
                  </p>
                ) : (
                  <p className="aviso-mensagem">
                    <strong>{deleteConfirm.name}</strong> será excluído.
                    {'\n'}
                    <span className="text-sm font-semibold text-red-700">Esta ação não pode ser desfeita.</span>
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3 mt-6">
                  <button autoFocus onClick={() => setDeleteConfirm(null)} className="aviso-btn aviso-btn-sec">
                    Cancelar
                  </button>
                  <button onClick={confirmDelete} className="aviso-btn" style={{ background: '#dc2626', color: '#fff' }}>
                    {deleteConfirm.type === 'equipe' ? 'Remover' : 'Excluir'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Segundo passo: a empresa atual e a UNICA da pessoa, entao nao ha o
            que remover. A escolha vira "apagar a conta" — e isso, sim, e
            irreversivel, por isso vem separado e com outra pergunta. */}
        {excluirContaConfirm && (
          <div className="fixed inset-0 min-h-screen z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="aviso-card max-w-sm w-full animate-in zoom-in-95 duration-200" role="alertdialog" aria-modal="true">
              <div className="aviso-faixa" style={{ background: '#dc2626' }}>
                <span className="aviso-icone" style={{ color: '#dc2626' }}><Trash2 size={28} strokeWidth={2.4} /></span>
                <h3 className="aviso-titulo">Excluir a conta?</h3>
              </div>
              <div className="aviso-corpo">
                <p className="aviso-mensagem">
                  A <strong>{FILIAL_META[nichoFilter].label}</strong> é a única empresa de{' '}
                  <strong>{excluirContaConfirm.name}</strong> — não há de onde removê-lo.
                  {'\n'}
                  <span className="text-sm text-gray-600">Excluir apaga o acesso dele por completo, e o e-mail volta a ficar livre.</span>
                  {'\n'}
                  <span className="text-sm font-semibold text-red-700">Esta ação não pode ser desfeita.</span>
                </p>
              <div className="grid grid-cols-2 gap-3 mt-6">
                <button
                  autoFocus
                  onClick={() => setExcluirContaConfirm(null)}
                  className="aviso-btn aviso-btn-sec"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const alvo = excluirContaConfirm;
                    setExcluirContaConfirm(null);
                    try {
                      await Storage.deleteUser(alvo.id);
                      setUsers(prev => prev.filter(u => u.id !== alvo.id));
                      toast.sucesso({ titulo: `Conta de ${alvo.name} excluída` });
                    } catch (err: any) {
                      showAlert(explicarErro(err, `excluir a conta de ${alvo.name}`));
                    }
                  }}
                  className="aviso-btn"
                  style={{ background: '#dc2626', color: '#fff' }}
                >
                  Excluir conta
                </button>
              </div>
              </div>
            </div>
          </div>
        )}

        {/* Detalhes — um desenho por tipo. Era um modal só para tudo: o
            produto aparecia com CPF, e-mail, limite de crédito e endereço
            vazios, e com o ID interno no lugar do documento. */}
        {viewingDetails && (() => {
          const d = viewingDetails;
          const tipo: 'produto' | 'servico' | 'cliente' | 'fornecedor' =
            subTab === 'produtos' ? 'produto' : subTab === 'servicos' ? 'servico' : subTab === 'fornecedores' ? 'fornecedor' : 'cliente';
          const fechar = () => setViewingDetails(null);
          const editar = () => { setViewingDetails(null); handleEdit(d, tipo); };
          const loja = (d.pdvMode ?? nichoFilter) as keyof typeof FILIAL_META;
          const ehPJ = d.type === 'PJ';
          const custo = Number(d.costPrice || 0);
          const preco = Number(d.price || 0);
          const margem = preco && custo ? ((preco - custo) / preco) * 100 : null;
          const markup = preco && custo ? ((preco - custo) / custo) * 100 : null;
          const minimo = d.minStock ?? 5;
          const semControle = d.controlStock === false;
          const situacaoEstoque = semControle ? null
            : d.stock <= minimo ? { txt: 'Abaixo do mínimo', bg: '#dc2626', fg: '#fff' }
            : minimo > 0 && d.stock <= minimo * 1.5 ? { txt: 'Perto do mínimo', bg: '#f59e0b', fg: '#1c1207' }
            : { txt: 'Estoque ok', bg: '#16a34a', fg: '#fff' };
          const ficha = tipo === 'produto'
            ? (ATRIBUTOS_PRODUTO[loja] ?? []).filter(a => (d.atributos as any)?.[a.key])
            : [];
          const endereco = [
            d.address ? `${d.address}, ${d.number || 's/n'}` : '',
            [d.neighborhood, d.complement].filter(Boolean).join(' · '),
            [d.city, d.state].filter(Boolean).join(' / '),
            d.zipCode ? `CEP ${d.zipCode}` : '',
          ].filter(Boolean);
          const data = (iso?: string) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '';

          return (
            <div
              className="fixed inset-0 min-h-screen z-[60] overflow-y-auto bg-black/70 backdrop-blur-md p-4 flex justify-center items-start animate-in fade-in duration-200"
              onClick={e => { if (e.target === e.currentTarget) fechar(); }}
            >
              <div className="form-cadastro p-5 md:p-7 max-w-3xl w-full my-8 animate-in slide-in-from-top duration-300">
                <CabecalhoForm
                  titulo={tipo === 'produto' ? 'Detalhes do produto' : tipo === 'servico' ? 'Detalhes do serviço' : tipo === 'cliente' ? 'Detalhes do cliente' : 'Detalhes do fornecedor'}
                  filial={loja}
                  onFechar={fechar}
                />

                {/* Identidade: foto (ou iniciais) + nome + situação */}
                <div className="flex items-center gap-4 mb-5">
                  {tipo === 'produto' ? (
                    <div className="w-20 h-20 rounded-xl bg-white overflow-hidden flex items-center justify-center shrink-0 border-2" style={{ borderColor: 'var(--accent)' }}>
                      {d.image ? <img src={d.image} alt="" className="w-full h-full object-cover" /> : <Package size={36} className="text-slate-400" />}
                    </div>
                  ) : tipo === 'servico' ? (
                    <div className="w-20 h-20 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                      <FileText size={34} />
                    </div>
                  ) : (
                    <div className="rounded-xl ring-2 ring-[var(--accent)] shrink-0">
                      <AvatarCadastro nome={d.name} image={d.image} size={80} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h4 className="text-xl font-bold text-white leading-tight break-words">{d.name}</h4>
                    {d.tradeName && <p className="text-sm text-white mt-0.5">{d.tradeName}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(tipo === 'cliente' || tipo === 'fornecedor') && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-white/15 text-white">{ehPJ ? 'Pessoa jurídica' : 'Pessoa física'}</span>
                      )}
                      {tipo === 'cliente' && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={d.status === 'inactive' ? { background: '#dc2626', color: '#fff' } : { background: '#16a34a', color: '#fff' }}>
                          {d.status === 'inactive' ? 'Inativo' : 'Ativo'}
                        </span>
                      )}
                      {d.category && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-white/15 text-white">{d.category}</span>}
                      {tipo === 'produto' && d.vitrine && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Na vitrine</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {(tipo === 'produto' || tipo === 'servico') && (
                    <section className="fc-section">
                      <h4 className="fc-section-title"><CircleDollarSign size={18} /> Preço</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Dado rotulo="Custo" valor={custo ? formatBRL(custo) : '—'} cor="#fca5a5" grande />
                        <Dado rotulo="Venda" valor={formatBRL(preco)} cor="#86efac" grande />
                        <Dado rotulo="Margem" valor={margem != null ? `${margem.toFixed(1).replace('.', ',')}%` : '—'} grande />
                        <Dado rotulo="Markup" valor={markup != null ? `${markup.toFixed(1).replace('.', ',')}%` : '—'} grande />
                      </div>
                      {preco && custo ? (
                        <p className="fc-hint mt-2">Lucro de {formatBRL(preco - custo)} por unidade vendida.</p>
                      ) : null}
                    </section>
                  )}

                  {tipo === 'produto' && (
                    <>
                      <section className="fc-section">
                        <div className="flex items-center justify-between gap-2 mb-4">
                          <h4 className="fc-section-title !mb-0"><Boxes size={18} /> Estoque</h4>
                          {situacaoEstoque && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ background: situacaoEstoque.bg, color: situacaoEstoque.fg }}>
                              {situacaoEstoque.txt}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <Dado rotulo="Saldo atual" valor={semControle ? 'Sem controle' : `${d.stock} ${d.unit || 'UN'}`} grande />
                          <Dado rotulo="Mínimo" valor={semControle ? '—' : `${minimo} ${d.unit || 'UN'}`} grande />
                          <Dado rotulo="Unidade" valor={d.unit || 'UN'} grande />
                        </div>
                      </section>

                      <section className="fc-section">
                        <h4 className="fc-section-title"><Tag size={18} /> Identificação</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Dado rotulo="Código / REF" valor={d.ref || '—'} mono />
                          <Dado rotulo="Código de barras (EAN-13)" valor={d.ean13 || '—'} mono />
                          {d.marca && <Dado rotulo="Marca" valor={d.marca} />}
                          {ficha.map(a => <Dado key={a.key} rotulo={a.label} valor={String((d.atributos as any)[a.key])} />)}
                        </div>
                      </section>
                    </>
                  )}

                  {tipo === 'servico' && d.additionalInfo && (
                    <section className="fc-section">
                      <h4 className="fc-section-title"><FileText size={18} /> Informações adicionais</h4>
                      <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{d.additionalInfo}</p>
                    </section>
                  )}

                  {(tipo === 'cliente' || tipo === 'fornecedor') && (
                    <>
                      <section className="fc-section">
                        <h4 className="fc-section-title"><UserIcon size={18} /> {ehPJ ? 'Dados da empresa' : 'Dados pessoais'}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Dado rotulo={ehPJ ? 'CNPJ' : 'CPF'} valor={d.document || '—'} mono />
                          <Dado rotulo={ehPJ ? 'Inscrição estadual' : 'RG'} valor={(ehPJ ? d.ie : d.rg) || '—'} mono />
                          {tipo === 'cliente' && <Dado rotulo={ehPJ ? 'Fundação' : 'Aniversário'} valor={data(d.birthDate) || '—'} />}
                          {tipo === 'cliente' && <Dado rotulo="Limite de crédito" valor={formatBRL(d.creditLimit || 0)} />}
                        </div>
                      </section>
                      <section className="fc-section">
                        <h4 className="fc-section-title"><Phone size={18} /> Contato</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {tipo === 'fornecedor' && <Dado rotulo="Pessoa de contato" valor={d.contact || '—'} />}
                          <Dado rotulo="Celular" valor={d.cellphone || '—'} />
                          <Dado rotulo="Telefone fixo" valor={d.phone || '—'} />
                          <Dado rotulo="E-mail" valor={d.email || '—'} />
                        </div>
                      </section>
                      <section className="fc-section">
                        <h4 className="fc-section-title"><MapPin size={18} /> Endereço</h4>
                        {endereco.length ? (
                          <p className="text-sm text-white leading-relaxed whitespace-pre-line">{endereco.join('\n')}</p>
                        ) : (
                          <p className="fc-hint !text-sm">Endereço não informado.</p>
                        )}
                      </section>
                      {d.observations && (
                        <section className="fc-section">
                          <h4 className="fc-section-title"><FileText size={18} /> Observações</h4>
                          <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{d.observations}</p>
                        </section>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-6 pt-5 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  <button type="button" onClick={fechar} className="smart-btn-secondary !text-sm !bg-transparent !text-white !border-white/30 hover:!bg-white/10">
                    Fechar
                  </button>
                  <button type="button" onClick={editar} className="smart-btn-primary !text-sm !px-8">
                    <Edit2 size={16} /> Editar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {currentListLength === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-gray-600 opacity-50 space-y-4">
            <Search size={48} />
            <p className="font-bold">Nenhum registro em "{subTab}" para "{search}"</p>
          </div>
        )}

        {/* Deixou de ser `sticky bottom-0`: a lista nao rola dentro do card —
            o card cresce com ela (4.877px com 59 produtos) e quem rola e a
            pagina. Preso ao rodape da JANELA, o contador ficava boiando por
            cima da linha que estivesse embaixo, o tempo todo. No fim da lista
            ele nao atrapalha ninguem e continua respondendo "quantos sao?".
            Os botoes Anterior / 1 / Proximo sairam: nao tinham onClick nem
            estado de pagina — eram desenho de paginacao, e a lista ja mostra
            todos os registros de uma vez. Controle que nao controla nada custa
            mais confianca do que economiza espaco. */}
        <div className="mt-auto px-4 py-2.5 flex justify-between items-center gap-4 text-sm text-gray-600 font-medium border-t border-gray-200 bg-white">
          <span>{currentListLength} de {totalLength} registros</span>
        </div>
      </div>
    </div>
  );
}
