export const maskCPF = (value: string) => {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})/, '$1-$2')
    .replace(/(-\d{2})\d+?$/, '$1');
};

export const maskCNPJ = (value: string) => {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
    .replace(/(-\d{2})\d+?$/, '$1');
};

export const maskRG = (value: string) => {
  // Common format: 00.000.000-0 or alphanumeric depending on state
  // We'll use a common numeric-first pattern but allow trailing X for some states
  return value
    .replace(/[^0-9axX]/g, '')
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})([0-9axX]{1})$/, '$1-$2')
    .toUpperCase();
};

export const maskPhone = (value: string) => {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{4})(\d)/, '$1-$2')
    .replace(/(\d{4})-(\d)(\d{4})/, '$1$2-$3') // adjustments for dynamic typing
    .replace(/(-\d{4})\d+?$/, '$1');
};

export const maskCellphone = (value: string) => {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2')
    .replace(/(-\d{4})\d+?$/, '$1');
};

export const maskCEP = (value: string) => {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{5})(\d)/, '$1-$2')
    .replace(/(-\d{3})\d+?$/, '$1');
};

export const maskCurrency = (value: string | number) => {
  if (value === undefined || value === null) return '';
  let v = String(value).replace(/\D/g, '');
  if (v === '') return '';
  v = (Number(v) / 100).toFixed(2).replace('.', ',');
  v = v.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v;
};

export const parseCurrencyToNumber = (value: string): number => {
  if (!value) return 0;
  const rawValue = value.replace(/\D/g, '');
  return parseFloat(rawValue) / 100 || 0;
};

/**
 * Máscara para percentual (0–100 com até 2 casas decimais, separador vírgula).
 * Diferente de maskCurrency: NÃO divide por 100 — o que o usuário digita é o
 * valor. Ex.: "10" → "10", "10,5" → "10,5", "1005" → "100" (teto),
 * "0,,5" → "0,5", "1,234" → "1,23".
 */
export const maskPercent = (value: string | number): string => {
  if (value === undefined || value === null) return '';
  let v = String(value).replace(/[^\d,]/g, '');
  const firstComma = v.indexOf(',');
  if (firstComma !== -1) {
    v = v.slice(0, firstComma + 1) + v.slice(firstComma + 1).replace(/,/g, '');
  }
  const parts = v.split(',');
  let intPart = parts[0].replace(/^0+(?=\d)/, '');
  if (intPart === '') intPart = '0';
  const asInt = parseInt(intPart, 10);
  if (asInt > 100) return '100';
  if (parts.length === 1) return intPart;
  return `${intPart},${parts[1].slice(0, 2)}`;
};

export const parsePercentToNumber = (value: string): number => {
  if (!value) return 0;
  const n = parseFloat(value.replace(',', '.'));
  return isFinite(n) ? n : 0;
};

/** Formata um número como moeda BR: "R$ 1.234,56" */
export const formatBRL = (n: number | null | undefined): string => {
  const v = typeof n === 'number' && !isNaN(n) ? n : 0;
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Aplica máscara CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) conforme nº de dígitos. */
export const maskCpfCnpj = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) return maskCPF(digits);
  return maskCNPJ(digits);
};

/** Valida CPF (11 dígitos com dígitos verificadores corretos). */
const isValidCPF = (d: string): boolean => {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let dv1 = (sum * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== parseInt(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  let dv2 = (sum * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === parseInt(d[10]);
};

/** Valida CNPJ (14 dígitos com dígitos verificadores corretos). */
const isValidCNPJ = (d: string): boolean => {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (slice: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += parseInt(slice[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(d.slice(0, 12), w1) === parseInt(d[12]) && calc(d.slice(0, 13), w2) === parseInt(d[13]);
};

/** Valida CPF (11) ou CNPJ (14). Aceita formato com máscara ou só dígitos. */
export const isValidCpfCnpj = (value: string): boolean => {
  const d = value.replace(/\D/g, '');
  if (d.length === 11) return isValidCPF(d);
  if (d.length === 14) return isValidCNPJ(d);
  return false;
};
