// Endereço: montagem para exibição e leitura do texto colado do MaxID.
//
// O MaxID gera o endereço já formatado numa linha só —
//
//   Rua das Flores, 123 — Centro, São Paulo/SP — CEP 01234-567
//
// e o aluno copiava essa linha e redigitava campo por campo no cadastro:
// sete campos, sete chances de errar, e o CEP quase sempre ficava vazio.
// `parseEnderecoColado` desmonta a linha de volta nos campos do formulário.
//
// O parser é deliberadamente tolerante: a turma tem prints e anotações de
// versões antigas do MaxID (sem CEP), digita hífen no lugar do travessão e
// às vezes cola só um pedaço. Cada campo é procurado por conta própria — o
// que não for reconhecido fica de fora, e a tela diz o que preencheu.

export interface EnderecoCampos {
  zipCode?: string;
  address?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

const UFS = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

export function formatarCEP(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Uma linha só, para o card da lista. Pula o que estiver vazio. */
export function formatarEnderecoLinha(p: {
  address?: string; number?: string; neighborhood?: string;
  city?: string; state?: string; zipCode?: string;
}): string {
  const rua = [p.address, p.number].filter(Boolean).join(', ');
  const cidadeUf = [p.city, p.state].filter(Boolean).join('/');
  return [rua, p.neighborhood, cidadeUf, p.zipCode].filter(Boolean).join(' · ');
}

/**
 * Lê o endereço colado e devolve só os campos que reconheceu.
 *
 * Ordem importa: CEP e Cidade/UF saem do texto primeiro, porque são os dois
 * com formato inconfundível. O que sobra é logradouro + número + bairro, que
 * dependem de posição e por isso são os menos confiáveis.
 */
export function parseEnderecoColado(texto: string): EnderecoCampos {
  const out: EnderecoCampos = {};
  let resto = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!resto) return out;

  // 1. CEP — 8 dígitos, com ou sem hífen, com ou sem o rótulo "CEP".
  const cep = /\b(\d{5})-?(\d{3})\b/.exec(resto);
  if (cep) {
    out.zipCode = `${cep[1]}-${cep[2]}`;
    resto = resto.replace(/\bCEP\b\s*:?\s*/i, ' ').replace(cep[0], ' ');
  }

  // 2. Cidade/UF — "São Paulo/SP", "São Paulo - SP", "São Paulo, SP".
  const cidadeUf = /([^,\/\-—]{2,})\s*[\/\-—,]\s*([A-Za-z]{2})(?=\s*[,.\-—]|\s*$)/.exec(resto);
  if (cidadeUf && UFS.has(cidadeUf[2].toUpperCase())) {
    out.city = cidadeUf[1].trim().replace(/^[,\-—\s]+/, '');
    out.state = cidadeUf[2].toUpperCase();
    resto = resto.replace(cidadeUf[0], ' ');
  }

  // 3. O que sobrou: "Rua das Flores, 123 — Centro". O travessão (ou hífen
  //    solto) separa endereço de bairro; o número é o último pedaço numérico
  //    antes dele.
  const partes = resto.split(/\s+[—–-]\s+/).map(s => s.trim()).filter(Boolean);
  const ruaENumero = partes[0] ?? '';
  const bairro = partes.slice(1).join(' ').trim();

  const pedacos = ruaENumero.split(',').map(s => s.trim()).filter(Boolean);
  if (pedacos.length) {
    const ultimo = pedacos[pedacos.length - 1];
    // "123", "123-A", "s/n" — número é o que começa com dígito, ou o s/n.
    if (/^(\d[\w/-]*|s\/?n\.?)$/i.test(ultimo) && pedacos.length > 1) {
      out.number = ultimo;
      out.address = pedacos.slice(0, -1).join(', ');
    } else {
      out.address = pedacos.join(', ');
    }
  }
  if (bairro) out.neighborhood = bairro.replace(/[,;.]+$/, '');

  // Limpeza final: sobra de pontuação nas bordas atrapalha mais que ajuda.
  (Object.keys(out) as (keyof EnderecoCampos)[]).forEach(k => {
    const v = out[k]?.replace(/^[\s,;.\-—]+|[\s,;.\-—]+$/g, '');
    if (v) out[k] = v; else delete out[k];
  });

  // Sem NENHUM sinal de que aquilo era mesmo um endereço — sem CEP, sem
  // cidade/UF, sem número e sem bairro — o que sobrou é só o texto que a
  // pessoa colou. Jogar isso no campo Endereço seria pior que não preencher:
  // ela veria "preenchido" e sairia com lixo gravado no cadastro.
  const temSinal = !!(out.zipCode || out.state || out.number || out.neighborhood);
  if (!temSinal) return {};
  return out;
}

/** Rótulos para dizer ao operador o que foi preenchido. */
export const ROTULO_ENDERECO: Record<keyof EnderecoCampos, string> = {
  zipCode: 'CEP',
  address: 'endereço',
  number: 'número',
  neighborhood: 'bairro',
  city: 'cidade',
  state: 'estado',
};
