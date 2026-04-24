'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Download,
  FileArchive,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatBytes, makeThumbnail, triggerDownload } from '@/lib/image-utils';

type BgItem = {
  id: string;
  name: string;
  file: File;
  thumbnailUrl: string;
  originalSize: number;
  resultBlob: Blob | null;
  resultUrl: string | null;
  resultSize: number | null;
  processing: boolean;
  progress: number;
  processed: boolean;
  error?: string;
};

export default function BackgroundPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<BgItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelLoadPct, setModelLoadPct] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      setItems((prev) => {
        prev.forEach((it) => {
          if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
        });
        return prev;
      });
    };
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<BgItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const processItem = useCallback(
    async (item: BgItem) => {
      updateItem(item.id, { processing: true, progress: 1, error: undefined });

      try {
        const mod = await import(
          /* webpackIgnore: true */ 'https://esm.sh/@imgly/background-removal@1.7.0'
        );
        const removeBackground: (
          input: Blob | File | string,
          config?: Record<string, unknown>,
        ) => Promise<Blob> = mod.removeBackground;

        const blob = await removeBackground(item.file, {
          publicPath:
            'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/',
          output: { format: 'image/png' },
          progress: (key, current, total) => {
            if (!total) return;
            const pct = Math.round((current / total) * 100);
            if (key.startsWith('fetch') || key.startsWith('download')) {
              setModelLoadPct(pct);
            } else {
              updateItem(item.id, { progress: Math.max(1, pct) });
            }
          },
        });

        setModelLoadPct(null);
        setModelReady(true);

        const url = URL.createObjectURL(blob);
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== item.id) return it;
            if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
            return {
              ...it,
              resultBlob: blob,
              resultUrl: url,
              resultSize: blob.size,
              processing: false,
              processed: true,
              progress: 0,
            };
          }),
        );
      } catch (err) {
        console.error(err);
        setModelLoadPct(null);
        updateItem(item.id, {
          processing: false,
          progress: 0,
          error: err instanceof Error ? err.message : 'Failed',
        });
        throw err;
      }
    },
    [updateItem],
  );

  const loadFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.error('No images found');
      return;
    }

    const newItems: BgItem[] = [];
    for (const file of imageFiles) {
      try {
        const thumbData = await fileToImageDataForThumb(file);
        newItems.push({
          id: crypto.randomUUID(),
          name: file.name,
          file,
          thumbnailUrl: makeThumbnail(thumbData, 160),
          originalSize: file.size,
          resultBlob: null,
          resultUrl: null,
          resultSize: null,
          processing: false,
          progress: 0,
          processed: false,
        });
      } catch (err) {
        toast.error(`Couldn't read ${file.name}`);
        console.error(err);
      }
    }

    if (newItems.length === 0) return;
    setItems((prev) => [...prev, ...newItems]);
    toast.success(`Added ${newItems.length} image${newItems.length > 1 ? 's' : ''}`);
  }, []);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) loadFiles(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) loadFiles(e.dataTransfer.files);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const hit = prev.find((i) => i.id === id);
      if (hit?.resultUrl) URL.revokeObjectURL(hit.resultUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const resetAll = () => {
    items.forEach((it) => {
      if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
    });
    setItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runActive = async (item: BgItem) => {
    try {
      await processItem(item);
      toast.success('Background removed');
    } catch {
      toast.error('Something went wrong');
    }
  };

  const runAll = async () => {
    const pending = items.filter((i) => !i.processed && !i.processing);
    if (pending.length === 0) {
      toast.error('Nothing to process');
      return;
    }
    setBatchRunning(true);
    let ok = 0;
    for (const item of pending) {
      try {
        await processItem(item);
        ok++;
      } catch {
        // per-item error already set
      }
    }
    setBatchRunning(false);
    toast.success(`Processed ${ok} of ${pending.length}`);
  };

  const downloadItem = (item: BgItem) => {
    if (!item.resultBlob) return;
    const base = item.name.replace(/\.[^.]+$/, '');
    triggerDownload(item.resultBlob, `${base}-nobg.png`);
  };

  const downloadAllZip = async () => {
    const ready = items.filter((i) => i.resultBlob);
    if (ready.length === 0) {
      toast.error('Nothing processed yet');
      return;
    }
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const item of ready) {
        const base = item.name.replace(/\.[^.]+$/, '');
        zip.file(`${base}-nobg.png`, item.resultBlob!);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      triggerDownload(out, 'no-background.zip');
      toast.success(`Zipped ${ready.length} image${ready.length > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error('Zip failed');
      console.error(err);
    } finally {
      setZipping(false);
    }
  };

  const pendingCount = items.filter((i) => !i.processed && !i.processing).length;
  const processedCount = items.filter((i) => i.processed).length;

  return (
    <div className="w-full">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <header className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <Sparkles className="h-3.5 w-3.5" />
            On-device AI — nothing uploaded
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
            Remove background
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
            Cut the subject out of any photo. The AI model (~40 MB) loads once into your browser on first use — after that it&apos;s offline.
          </p>
        </header>

        {modelLoadPct != null && !modelReady && (
          <Card className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
            <div className="flex items-center gap-3 p-4">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="flex-1">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Downloading model… {modelLoadPct}%
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-900/60">
                  <div
                    className="h-full bg-amber-700 transition-[width] duration-150 ease-out dark:bg-amber-300"
                    style={{ width: `${modelLoadPct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                  One-time download, cached for next visits.
                </p>
              </div>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-4 border-2 border-dashed p-16 transition-colors ${
                isDragOver
                  ? 'border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800/50'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              <div className="rounded-full bg-slate-100 p-4 dark:bg-slate-800">
                <Upload className="h-8 w-8 text-slate-600 dark:text-slate-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  Drop photos here
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Works best with clear subjects. Multiple files allowed.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onPickFiles}
              />
            </label>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={batchRunning || zipping}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add images
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetAll}
                    disabled={batchRunning || zipping}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    Clear all
                  </Button>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    ref={fileInputRef}
                    onChange={onPickFiles}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="lg"
                    onClick={runAll}
                    disabled={batchRunning || pendingCount === 0}
                    className="min-w-[180px]"
                  >
                    <Wand2 className="mr-2 h-4 w-4" />
                    {batchRunning ? 'Running…' : `Remove all (${pendingCount})`}
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={downloadAllZip}
                    disabled={processedCount === 0 || zipping || batchRunning}
                    className="min-w-[180px]"
                  >
                    <FileArchive className="mr-2 h-4 w-4" />
                    {zipping ? 'Zipping…' : `Download zip (${processedCount})`}
                  </Button>
                </div>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
                    <div className="flex shrink-0 items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="h-20 w-20 rounded object-cover"
                      />
                      {item.resultUrl && (
                        <>
                          <Scissors className="h-4 w-4 text-slate-400" />
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.resultUrl}
                            alt=""
                            className="h-20 w-20 rounded bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:10px_10px] bg-[position:0_0,0_5px,5px_-5px,-5px_0] object-contain"
                          />
                        </>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {item.name}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                        {formatBytes(item.originalSize)}
                        {item.resultSize != null && (
                          <>
                            <span className="mx-1.5">→</span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {formatBytes(item.resultSize)} (PNG)
                            </span>
                          </>
                        )}
                      </div>
                      {item.processing && (
                        <div className="mt-2">
                          <div className="text-xs text-slate-500">
                            Processing… {item.progress}%
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div
                              className="h-full bg-slate-900 transition-[width] duration-150 dark:bg-slate-100"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {item.error && (
                        <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {item.error}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {!item.processed ? (
                        <Button
                          size="sm"
                          onClick={() => runActive(item)}
                          disabled={item.processing || batchRunning}
                        >
                          <Wand2 className="mr-1.5 h-4 w-4" />
                          {item.processing ? 'Processing…' : 'Remove bg'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => downloadItem(item)}
                        >
                          <Download className="mr-1.5 h-4 w-4" />
                          Download
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        disabled={item.processing}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
          Runs offline after the first model download. Output is a transparent PNG.
        </p>
      </div>
    </div>
  );
}

function fileToImageDataForThumb(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
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
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
