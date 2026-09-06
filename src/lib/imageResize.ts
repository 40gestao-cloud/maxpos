// Redimensionamento de imagem no browser, antes de virar base64 no banco.
//
// Existe porque o avatar do perfil era gravado CRU: `FileReader.readAsDataURL`
// direto no `user_profiles.avatar`. Uma foto de celular virava 5 MB de base64
// numa coluna que o `getSession()` lê a cada login e a cada refresh de token —
// o operador esperava o download de 5 MB pra ver a tela de PDV.
//
// O avatar aparece em 44x44 px no header e 88x88 na tela de perfil. 256 px de
// lado cobre tela retina com folga; o resto era peso puro.

export interface ResizeOpts {
  /** Maior lado da imagem final, em pixels. */
  maxLado?: number;
  /** Qualidade JPEG (0-1). */
  qualidade?: number;
}

/**
 * Lê o arquivo, reduz para caber em `maxLado` e devolve um data URL JPEG.
 *
 * Mantém a proporção. Imagem menor que o limite não é ampliada — só
 * recomprimida, o que já derruba PNG de câmera para uma fração do tamanho.
 */
export function resizeImageToDataUrl(file: File, opts: ResizeOpts = {}): Promise<string> {
  const maxLado = opts.maxLado ?? 256;
  const qualidade = opts.qualidade ?? 0.85;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo não é uma imagem válida.'));
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala));
        const h = Math.max(1, Math.round(img.height * escala));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas indisponível neste navegador.')); return; }
        // Fundo branco: JPEG não tem alfa, e PNG transparente sem isto vira
        // preto no lugar do transparente.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Compressão com TETO de bytes (mesmo tratamento do LogMax)
//
// O formulário de produto exigia que o usuário já trouxesse um arquivo de até
// 120 KB — ou seja, jogava no operador um trabalho de editor de imagem que o
// navegador faz sozinho em 200 ms. Aqui ele escolhe a foto boa (até 10 MB) e o
// app reduz, recomprime e só então grava o base64 na coluna `image`.
//
// A escada existe porque uma única qualidade não serve pra tudo: foto lisa cabe
// no teto em 0.85, foto cheia de textura só cabe caindo qualidade e, no limite,
// dimensão. Sempre entrega a MELHOR que coube.
// ─────────────────────────────────────────────────────────────────────────────

/** Teto bruto de entrada — acima disso nem tenta decodificar (evita travar o dispositivo). */
export const IMAGEM_MAX_ENTRADA_BYTES = 10 * 1024 * 1024;
export const IMAGEM_MAX_ENTRADA_LABEL = '10 MB';

const QUALIDADES = [0.85, 0.72, 0.6, 0.45, 0.35];
const ESCALAS = [1, 0.8, 0.6, 0.45];

export interface ComprimirOpts {
  /** Maior lado da imagem final, em pixels. */
  maxLado?: number;
  /** Teto do arquivo final, em bytes (medido já em base64 decodificado). */
  maxBytes?: number;
}

function carregarImagem(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo não é uma imagem válida ou está corrompido.'));
      img.onload = () => resolve(img);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function desenhar(img: HTMLImageElement, largura: number, altura: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  ctx.imageSmoothingQuality = 'high';
  // Fundo branco pelo mesmo motivo do resize do avatar: PNG transparente
  // exportado em JPEG vira preto sem isto.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(img, 0, 0, largura, altura);
  return canvas;
}

/**
 * Reduz e recomprime até caber em `maxBytes`, devolvendo um data URL.
 *
 * Nunca amplia: imagem menor que `maxLado` só é recomprimida. Se nem a última
 * combinação da escada couber no teto, lança erro com o tamanho que sobrou —
 * melhor avisar do que gravar um base64 gigante na linha do produto.
 */
export async function comprimirImagemParaTeto(
  file: File,
  opts: ComprimirOpts = {},
): Promise<string> {
  const maxLado = opts.maxLado ?? 900;
  const maxBytes = opts.maxBytes ?? 120 * 1024;

  if (file.size > IMAGEM_MAX_ENTRADA_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`Imagem com ${mb} MB — máximo ${IMAGEM_MAX_ENTRADA_LABEL}. Reduza antes de enviar.`);
  }

  const img = await carregarImagem(file);
  // WebP rende ~30% a menos que JPEG na mesma qualidade; se o navegador não
  // souber exportar, `toDataURL` devolve PNG e a gente cai pra JPEG.
  const suportaWebp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  const mime = suportaWebp ? 'image/webp' : 'image/jpeg';

  let menor: string | null = null;
  for (const escala of ESCALAS) {
    const base = Math.min(1, maxLado / Math.max(img.width, img.height)) * escala;
    const w = Math.max(1, Math.round(img.width * base));
    const h = Math.max(1, Math.round(img.height * base));
    const canvas = desenhar(img, w, h);
    for (const q of QUALIDADES) {
      const dataUrl = canvas.toDataURL(mime, q);
      const bytes = tamanhoDataUrl(dataUrl);
      if (!menor || bytes < tamanhoDataUrl(menor)) menor = dataUrl;
      if (bytes <= maxBytes) return dataUrl;
    }
  }

  const kb = menor ? Math.round(tamanhoDataUrl(menor) / 1024) : 0;
  throw new Error(
    `Não foi possível comprimir a imagem abaixo de ${Math.round(maxBytes / 1024)} KB (ficou em ${kb} KB). Tente uma foto com menos detalhe.`,
  );
}

/** Tamanho aproximado, em bytes, do conteúdo de um data URL base64. */
export function tamanhoDataUrl(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  // Cada 4 chars de base64 = 3 bytes, descontando o padding '='.
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
}
