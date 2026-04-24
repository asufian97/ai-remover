export function runInpaint(
  imageData: ImageData,
  mask: Uint8Array,
  onProgress: (pct: number) => void,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./inpaint.worker.ts', import.meta.url));

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress(msg.pct);
      } else if (msg.type === 'done') {
        cleanup();
        const result = new ImageData(
          new Uint8ClampedArray(msg.buffer),
          msg.width,
          msg.height,
        );
        resolve(result);
      } else if (msg.type === 'error') {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(new Error(err.message || 'Worker error'));
    };

    const copy = new Uint8ClampedArray(imageData.data);
    worker.postMessage(
      {
        buffer: copy.buffer,
        width: imageData.width,
        height: imageData.height,
        mask,
      },
      [copy.buffer],
    );
  });
}
