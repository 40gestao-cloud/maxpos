// Monograma: sem foto, o card mostra as iniciais sobre uma cor derivada do
// nome. Cor fixa por nome (e não aleatória) porque o mesmo fornecedor precisa
// ter sempre a mesma cor — é isso que faz o olho reencontrá-lo na lista.
const CORES_MONOGRAMA = ['#1e3a8a', '#7c2d12', '#14532d', '#581c87', '#7f1d1d', '#134e4a', '#713f12', '#312e81'];

function corDoNome(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return CORES_MONOGRAMA[h % CORES_MONOGRAMA.length];
}

function iniciais(nome: string): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function AvatarCadastro({ nome, image, size = 48 }: { nome: string; image?: string; size?: number }) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className="rounded-xl object-cover shrink-0 border border-gray-300"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-xl shrink-0 flex items-center justify-center font-black text-white tracking-wider"
      style={{ width: size, height: size, background: corDoNome(nome), fontSize: size * 0.34 }}
    >
      {iniciais(nome)}
    </div>
  );
}
