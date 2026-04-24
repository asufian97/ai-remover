export type ExportFormat = 'png' | 'jpeg' | 'webp';

export function fileToImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas context failed'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export function makeThumbnail(data: ImageData, maxSize: number): string {
  const scale = Math.min(maxSize / data.width, maxSize / data.height, 1);
  const w = Math.max(1, Math.round(data.width * scale));
  const h = Math.max(1, Math.round(data.height * scale));
  const src = document.createElement('canvas');
  src.width = data.width;
  src.height = data.height;
  const srcCtx = src.getContext('2d');
  if (!srcCtx) return '';
  srcCtx.putImageData(data, 0, 0);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outCtx = out.getContext('2d');
  if (!outCtx) return '';
  outCtx.drawImage(src, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.7);
}

export async function imageDataToBlob(
  data: ImageData,
  format: ExportFormat,
  quality: number,
  maxDim: number | null,
): Promise<Blob | null> {
  let w = data.width;
  let h = data.height;
  if (maxDim && Math.max(w, h) > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (w !== data.width || h !== data.height) {
    const src = document.createElement('canvas');
    src.width = data.width;
    src.height = data.height;
    const sctx = src.getContext('2d');
    if (!sctx) return null;
    sctx.putImageData(data, 0, 0);
    ctx.drawImage(src, 0, 0, w, h);
  } else {
    ctx.putImageData(data, 0, 0);
  }
  const mime =
    format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const q = format === 'png' ? undefined : quality / 100;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, q);
  });
}

export function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function makeExportName(
  originalName: string,
  format: ExportFormat,
  suffix = '-cleaned',
): string {
  const dot = originalName.lastIndexOf('.');
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `${base}${suffix}.${ext}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
