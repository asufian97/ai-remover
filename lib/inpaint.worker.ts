/// <reference lib="webworker" />
export {};

declare const self: DedicatedWorkerGlobalScope;

type InpaintRequest = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  mask: Uint8Array;
};

self.addEventListener('message', (e: MessageEvent<InpaintRequest>) => {
  const { buffer, width, height, mask } = e.data;
  try {
    const out = new Uint8ClampedArray(buffer);
    inpaint(out, width, height, mask, (pct) => {
      self.postMessage({ type: 'progress', pct });
    });
    self.postMessage({ type: 'done', buffer: out.buffer, width, height }, [out.buffer]);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

function inpaint(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  originalMask: Uint8Array,
  onProgress: (pct: number) => void,
): void {
  const m = new Uint8Array(originalMask);

  let initialCount = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) initialCount++;

  const maxIter = Math.max(width, height);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    const nextMask = new Uint8Array(m);
    const nextOut = new Uint8ClampedArray(out);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (m[idx] === 0) continue;

        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nIdx = ny * width + nx;
            if (m[nIdx] === 0) {
              const p = nIdx * 4;
              r += out[p];
              g += out[p + 1];
              b += out[p + 2];
              count++;
            }
          }
        }

        if (count > 0) {
          const p = idx * 4;
          nextOut[p] = r / count;
          nextOut[p + 1] = g / count;
          nextOut[p + 2] = b / count;
          nextOut[p + 3] = 255;
          nextMask[idx] = 0;
          changed = true;
        }
      }
    }

    out.set(nextOut);
    m.set(nextMask);

    if (iter % 5 === 0) {
      let remaining = 0;
      for (let i = 0; i < m.length; i++) if (m[i]) remaining++;
      const pct = initialCount > 0 ? 80 * (1 - remaining / initialCount) : 80;
      onProgress(pct);
    }

    if (!changed) break;
  }
  onProgress(82);

  for (let pass = 0; pass < 4; pass++) {
    const smoothed = new Uint8ClampedArray(out);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (originalMask[idx] === 0) continue;

        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nIdx = ny * width + nx;
            const p = nIdx * 4;
            r += out[p];
            g += out[p + 1];
            b += out[p + 2];
            count++;
          }
        }
        const p = idx * 4;
        smoothed[p] = r / count;
        smoothed[p + 1] = g / count;
        smoothed[p + 2] = b / count;
        smoothed[p + 3] = 255;
      }
    }
    out.set(smoothed);
    onProgress(82 + (pass + 1) * 4.5);
  }

  onProgress(100);
}
