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
