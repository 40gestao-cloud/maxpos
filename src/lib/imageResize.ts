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

/** Tamanho aproximado, em bytes, do conteúdo de um data URL base64. */
export function tamanhoDataUrl(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  // Cada 4 chars de base64 = 3 bytes, descontando o padding '='.
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
}
