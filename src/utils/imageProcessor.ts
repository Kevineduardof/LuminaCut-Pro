import { removeBackground, Config } from '@imgly/background-removal';

export interface EdgeRefinementOptions {
  /** -50 to +50: shifts the alpha midpoint (choke / spread) */
  edgeShift: number;
  /** 0 to 100: increases contrast on semi-transparent edges */
  edgeContrast: number;
  /** 0 to 10: radius for subtle alpha edge smoothing */
  feather: number;
  /** Whether to decontaminate background color bleed on semi-transparent border pixels */
  decontaminate: boolean;
  /** Preserve 100% original RGB values from the source image buffer */
  preserveOriginalRgb: boolean;
}

export interface BackdropOptions {
  type: 'transparent-dark' | 'transparent-light' | 'solid' | 'gradient';
  solidColor: string;
  gradientFrom: string;
  gradientTo: string;
}

export interface ProcessedImageData {
  width: number;
  height: number;
  originalImageData: ImageData;
  rawAlphaChannel: Uint8Array;
  originalUrl: string;
  fileName: string;
  originalSizeBytes: number;
}

/**
 * Loads an image File or Blob into an HTMLImageElement and extracts its full-resolution ImageData.
 */
export async function loadImageFullRes(fileOrBlob: File | Blob, fileName = 'imagem.png'): Promise<{
  img: HTMLImageElement;
  imageData: ImageData;
  objectUrl: string;
  width: number;
  height: number;
  fileName: string;
  sizeBytes: number;
}> {
  const objectUrl = URL.createObjectURL(fileOrBlob);
  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Falha ao carregar a imagem selecionada.'));
    img.src = objectUrl;
  });

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Não foi possível inicializar o contexto 2D de alta resolução.');
  }

  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  return {
    img,
    imageData,
    objectUrl,
    width,
    height,
    fileName,
    sizeBytes: fileOrBlob.size,
  };
}

/**
 * Runs the AI segmentation and extracts a full-resolution raw alpha channel (Uint8Array)
 * aligned pixel-by-pixel with the original image dimensions.
 */
export async function extractHighResAlphaMask(
  sourceBlob: Blob,
  targetWidth: number,
  targetHeight: number,
  modelQuality: 'isnet' | 'isnet_fp16',
  onProgress?: (stage: string, progressPercent: number) => void
): Promise<Uint8Array> {
  const config: Config = {
    model: modelQuality,
    output: {
      format: 'image/png',
      quality: 1.0,
    },
    progress: (key: string, current: number, total: number) => {
      if (!onProgress) return;
      const ratio = total > 0 ? Math.min(1, current / total) : 0;
      if (key.includes('fetch')) {
        onProgress('Baixando modelo neural IA (cache local)...', Math.round(ratio * 60));
      } else if (key.includes('compute') || key.includes('inference')) {
        onProgress('Processando segmentação de alta precisão...', 60 + Math.round(ratio * 35));
      } else {
        onProgress('Analisando estrutura e bordas...', Math.min(95, Math.round(ratio * 90)));
      }
    },
  };

  onProgress?.('Iniciando motor neural IA...', 5);
  const resultBlob = await removeBackground(sourceBlob, config);
  onProgress?.('Extraindo máscara alfa na resolução nativa...', 96);

  const maskUrl = URL.createObjectURL(resultBlob);
  try {
    const maskImg = new Image();
    await new Promise<void>((resolve, reject) => {
      maskImg.onload = () => resolve();
      maskImg.onerror = () => reject(new Error('Falha ao decodificar máscara gerada pela IA.'));
      maskImg.src = maskUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Erro ao criar canvas de máscara.');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(maskImg, 0, 0, targetWidth, targetHeight);

    const maskImageData = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
    const alphaChannel = new Uint8Array(targetWidth * targetHeight);

    for (let i = 0, p = 0; i < maskImageData.length; i += 4, p++) {
      alphaChannel[p] = maskImageData[i + 3];
    }

    onProgress?.('Concluído com fidelidade máxima!', 100);
    return alphaChannel;
  } finally {
    URL.revokeObjectURL(maskUrl);
  }
}

/**
 * Fast separable 1D box blur on an alpha channel for smooth edge feathering.
 */
function smoothAlphaChannel(
  alpha: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  if (radius <= 0) return alpha;
  const r = Math.min(10, Math.round(radius));
  const temp = new Uint8Array(alpha.length);
  const output = new Uint8Array(alpha.length);
  const windowSize = 2 * r + 1;

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const rowOffset = y * width;
    for (let i = -r; i <= r; i++) {
      const x = Math.min(width - 1, Math.max(0, i));
      sum += alpha[rowOffset + x];
    }
    for (let x = 0; x < width; x++) {
      temp[rowOffset + x] = (sum / windowSize) | 0;
      const leftX = Math.max(0, x - r);
      const rightX = Math.min(width - 1, x + r + 1);
      sum += alpha[rowOffset + rightX] - alpha[rowOffset + leftX];
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      const y = Math.min(height - 1, Math.max(0, i));
      sum += temp[y * width + x];
    }
    for (let y = 0; y < height; y++) {
      output[y * width + x] = (sum / windowSize) | 0;
      const topY = Math.max(0, y - r);
      const bottomY = Math.min(height - 1, y + r + 1);
      sum += temp[bottomY * width + x] - temp[topY * width + x];
    }
  }

  return output;
}

/**
 * Applies real-time edge refinements and composites the original uncompressed RGB pixels
 * with the refined alpha channel. Zero quality loss on foreground pixels!
 */
export function renderRefinedCutout(
  data: ProcessedImageData,
  options: EdgeRefinementOptions,
  viewMaskOnly = false
): {
  cutoutDataUrl: string;
  canvas: HTMLCanvasElement;
} {
  const { width, height, originalImageData, rawAlphaChannel } = data;
  const srcPixels = originalImageData.data;

  // Step 1: Apply optional feathering
  const baseAlpha =
    options.feather > 0
      ? smoothAlphaChannel(rawAlphaChannel, width, height, options.feather)
      : rawAlphaChannel;

  // Step 2: Build lookup table (LUT) for edgeShift and edgeContrast
  // Fast 256-entry LUT so even 4K/8K images update in milliseconds!
  const alphaLut = new Uint8Array(256);
  const shift = -(options.edgeShift / 100) * 128; // positive edgeShift expands foreground
  const contrastFactor = 1 + (options.edgeContrast / 100) * 3.5;

  for (let a = 0; a < 256; a++) {
    if (a === 0) {
      alphaLut[a] = 0;
      continue;
    }
    if (a === 255 && options.edgeShift >= 0) {
      alphaLut[a] = 255;
      continue;
    }
    const shifted = a - shift;
    const normalized = (shifted - 127.5) * contrastFactor + 127.5;
    alphaLut[a] = Math.max(0, Math.min(255, Math.round(normalized)));
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const ctx = outCanvas.getContext('2d')!;
  const outImageData = ctx.createImageData(width, height);
  const dstPixels = outImageData.data;

  const totalPixels = width * height;

  if (viewMaskOnly) {
    // High-contrast monochrome alpha mask inspection mode
    for (let p = 0, i = 0; p < totalPixels; p++, i += 4) {
      const a = alphaLut[baseAlpha[p]];
      dstPixels[i] = a;
      dstPixels[i + 1] = a;
      dstPixels[i + 2] = a;
      dstPixels[i + 3] = 255;
    }
  } else {
    // Full-Resolution True-RGB Composition + Optional Edge Color Decontamination
    const decontaminate = options.decontaminate;
    const searchOffsets = [
      -width - 2, -width, -width + 2,
      -2, 2,
      width - 2, width, width + 2,
      -width * 3, width * 3, -3, 3,
    ];

    for (let p = 0, i = 0; p < totalPixels; p++, i += 4) {
      const a = alphaLut[baseAlpha[p]];
      if (a === 0) {
        dstPixels[i + 3] = 0;
        continue;
      }

      let r = srcPixels[i];
      let g = srcPixels[i + 1];
      let b = srcPixels[i + 2];

      // Edge color decontamination: if pixel is on semi-transparent border,
      // blend RGB slightly toward nearest solid foreground pixel to remove background halo
      if (decontaminate && a > 8 && a < 230) {
        let fgR = 0, fgG = 0, fgB = 0, count = 0;
        for (let k = 0; k < searchOffsets.length; k++) {
          const np = p + searchOffsets[k];
          if (np >= 0 && np < totalPixels && alphaLut[baseAlpha[np]] >= 235) {
            const ni = np * 4;
            fgR += srcPixels[ni];
            fgG += srcPixels[ni + 1];
            fgB += srcPixels[ni + 2];
            count++;
          }
        }
        if (count > 0) {
          const weight = (230 - a) / 230; // stronger decontamination on lower alpha edge pixels
          r = Math.round(r * (1 - weight * 0.75) + (fgR / count) * (weight * 0.75));
          g = Math.round(g * (1 - weight * 0.75) + (fgG / count) * (weight * 0.75));
          b = Math.round(b * (1 - weight * 0.75) + (fgB / count) * (weight * 0.75));
        }
      }

      dstPixels[i] = r;
      dstPixels[i + 1] = g;
      dstPixels[i + 2] = b;
      dstPixels[i + 3] = a;
    }
  }

  ctx.putImageData(outImageData, 0, 0);
  return {
    cutoutDataUrl: outCanvas.toDataURL('image/png'),
    canvas: outCanvas,
  };
}

/**
 * Exports the full-resolution image with optional custom background in lossless PNG or high-quality WebP.
 */
export async function exportFullResolutionImage(
  cutoutCanvas: HTMLCanvasElement,
  backdrop: BackdropOptions,
  format: 'image/png' | 'image/webp',
  includeBackdrop: boolean
): Promise<Blob> {
  const width = cutoutCanvas.width;
  const height = cutoutCanvas.height;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext('2d')!;

  if (includeBackdrop && (backdrop.type === 'solid' || backdrop.type === 'gradient')) {
    if (backdrop.type === 'solid') {
      ctx.fillStyle = backdrop.solidColor;
      ctx.fillRect(0, 0, width, height);
    } else if (backdrop.type === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, backdrop.gradientFrom);
      grad.addColorStop(1, backdrop.gradientTo);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  }

  ctx.drawImage(cutoutCanvas, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    exportCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao exportar a imagem em alta resolução.'));
      },
      format,
      1.0 // Maximum lossless/near-lossless quality
    );
  });
}

/**
 * Generates a high-resolution sample photograph/illustration on canvas (1600x1200)
 * so the user can test the AI background removal & zoom immediately even offline.
 */
export async function createHighResDemoImage(): Promise<File> {
  const width = 1600;
  const height = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 1. Draw complex vibrant sunset & city bokeh background (to be removed by AI)
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
  skyGrad.addColorStop(0, '#0f172a');
  skyGrad.addColorStop(0.45, '#3b0764');
  skyGrad.addColorStop(0.8, '#be185d');
  skyGrad.addColorStop(1, '#f59e0b');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Bokeh lights in background
  const bokehColors = ['#f472b6', '#fbbf24', '#38bdf8', '#a855f7', '#fb7185'];
  for (let i = 0; i < 45; i++) {
    const x = ((i * 197) % width);
    const y = ((i * 263) % (height - 150)) + 50;
    const radius = 25 + ((i * 37) % 85);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = bokehColors[i % bokehColors.length];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Distant mountain silhouettes in background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, 820);
  ctx.lineTo(350, 670);
  ctx.lineTo(720, 790);
  ctx.lineTo(1180, 620);
  ctx.lineTo(1600, 760);
  ctx.lineTo(1600, height);
  ctx.closePath();
  ctx.fill();

  // 2. Draw a crisp foreground subject: A detailed vintage camera on a pedestal / character portrait
  ctx.save();
  ctx.translate(width / 2, height / 2 + 40);

  // Subtle drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 320, 320, 42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Camera body base (metallic brushed silver + dark leatherette)
  const bodyGrad = ctx.createLinearGradient(-320, -220, 320, 260);
  bodyGrad.addColorStop(0, '#334155');
  bodyGrad.addColorStop(0.5, '#1e293b');
  bodyGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(-320, -160, 640, 440, 42);
  ctx.fill();
  ctx.stroke();

  // Top metallic plate
  const topGrad = ctx.createLinearGradient(-320, -240, 320, -140);
  topGrad.addColorStop(0, '#f8fafc');
  topGrad.addColorStop(0.5, '#cbd5e1');
  topGrad.addColorStop(1, '#94a3b8');
  ctx.fillStyle = topGrad;
  ctx.beginPath();
  ctx.roundRect(-320, -240, 640, 110, [42, 42, 8, 8]);
  ctx.fill();

  // Viewfinder hump
  ctx.fillStyle = topGrad;
  ctx.beginPath();
  ctx.moveTo(-140, -240);
  ctx.lineTo(-90, -330);
  ctx.lineTo(90, -330);
  ctx.lineTo(140, -240);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Shutter button & dials
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(170, -280, 90, 40);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(195, -300, 40, 20);

  // Red stripe accent
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-260, -100, 18, 330);

  // Precision Lens Barrel (concentric rings with fine details to test zoom!)
  const ringRadii = [225, 195, 165, 130];
  const ringColors = ['#e2e8f0', '#334155', '#1e293b', '#090d16'];
  ringRadii.forEach((r, idx) => {
    ctx.beginPath();
    ctx.arc(20, 65, r, 0, Math.PI * 2);
    ctx.fillStyle = ringColors[idx];
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = idx === 0 ? '#94a3b8' : '#475569';
    ctx.stroke();
  });

  // Lens glass multi-coating reflection
  const glassGrad = ctx.createRadialGradient(-20, 25, 15, 20, 65, 125);
  glassGrad.addColorStop(0, '#38bdf8');
  glassGrad.addColorStop(0.35, '#4f46e5');
  glassGrad.addColorStop(0.75, '#1e1b4b');
  glassGrad.addColorStop(1, '#020617');
  ctx.beginPath();
  ctx.arc(20, 65, 122, 0, Math.PI * 2);
  ctx.fillStyle = glassGrad;
  ctx.fill();

  // Specular highlights on lens
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.beginPath();
  ctx.ellipse(-25, 20, 38, 18, -Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.beginPath();
  ctx.arc(65, 110, 22, 0, Math.PI * 2);
  ctx.fill();

  // Crisp micro-engraving text around lens ring (great for testing 400% zoom!)
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LUMINACUT PRO • 50mm f/1.2 ULTRA-HD LENS • 1600×1200px', 20, -110);

  ctx.restore();

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png', 1.0)
  );
  return new File([blob], 'demo-camera-ultra-hd.png', { type: 'image/png' });
}

