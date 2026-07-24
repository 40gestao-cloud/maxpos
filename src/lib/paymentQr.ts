// Payload dos QRs de cobrança do MaxPOS (PDV SuperMax/MaxLook/TechMax).
//
//   URL absoluta:  <VITE_MAXBANK_URL>/pagar[-cartao]/<branchId>/<uuid>
//   Fallback:      MAX-PIX-<uuid>  /  MAX-CARTAO-<uuid>
//
// Formato URL permite que o aluno externo escaneie com a câmera nativa do
// celular (Camera do iOS, Google Lens, qualquer scanner) e caia direto na
// Área do Cliente do MaxBank sem cadastro. Fallback preservado pra rodar
// offline / sem envs.
function envBase(): { base: string; branchId: string } | null {
  const base = (import.meta.env.VITE_MAXBANK_URL as string | undefined)?.replace(/\/$/, '');
  const branchId = import.meta.env.VITE_MAXBANK_BRANCH_ID as string | undefined;
  if (base && branchId) return { base, branchId };
  return null;
}

export function buildPixQrValue(pixId: string): string {
  const env = envBase();
  return env ? `${env.base}/pagar/${env.branchId}/${pixId}` : `MAX-PIX-${pixId}`;
}

export function buildCartaoQrValue(cartaoId: string): string {
  const env = envBase();
  return env ? `${env.base}/pagar-cartao/${env.branchId}/${cartaoId}` : `MAX-CARTAO-${cartaoId}`;
}
