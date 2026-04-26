'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ArrowRight,
  Download,
  FileArchive,
  GitCompareArrows,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
  ZoomIn,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fileToImageData,
  formatBytes,
  imageDataToBlob,
  makeThumbnail,
  triggerDownload,
} from '@/lib/image-utils';

type Scale = 2 | 4;
type Mode = 'photo' | 'compressed';

const MODELS: Record<string, string> = {
  '2-photo': 'Xenova/swin2SR-classical-sr-x2-64',
  '4-photo': 'Xenova/swin2SR-classical-sr-x4-64',
  '4-compressed': 'Xenova/swin2SR-compressed-sr-x4-48',
};

const MAX_INPUT_DIM_BY_SCALE: Record<number, number> = { 2: 768, 4: 384 };
const TRANSFORMERS_CDN = 'https://esm.sh/@xenova/transformers@2.17.2';

type UpscaleItem = {
  id: string;
  name: string;
  imageData: ImageData;
  thumbnailUrl: string;
  originalSize: number;
  originalWidth: number;
  originalHeight: number;
  inputWidth: number;
  inputHeight: number;
  resultBlob: Blob | null;
  resultUrl: string | null;
  resultSize: number | null;
  resultWidth: number | null;
  resultHeight: number | null;
  processing: boolean;
  processed: boolean;
  error?: string;
};

type Pipeline = (input: string | Blob) => Promise<{
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}>;

export default function UpscalePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const sliderDragRef = useRef(false);
  const pipelineCache = useRef<Map<string, Pipeline>>(new Map());

  const [items, setItems] = useState<UpscaleItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [zipping, setZipping] = useState(false);

  const [scale, setScale] = useState<Scale>(2);
  const [mode, setMode] = useState<Mode>('photo');
  const [modelLoadPct, setModelLoadPct] = useState<number | null>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);

  const [compareId, setCompareId] = useState<string | null>(null);
  const [sliderPct, setSliderPct] = useState(50);
  const compareItem = compareId
    ? items.find((i) => i.id === compareId) ?? null
    : null;

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

  useEffect(() => {
    if (!compareId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompareId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compareId]);

  useEffect(() => {
    if (!compareItem || !compareItem.resultBlob) return;
    const ocanvas = originalCanvasRef.current;
    const rcanvas = resultCanvasRef.current;
    if (!ocanvas || !rcanvas) return;

    const oimg = new Image();
    oimg.onload = () => {
      ocanvas.width = oimg.naturalWidth;
      ocanvas.height = oimg.naturalHeight;
      ocanvas.getContext('2d')?.drawImage(oimg, 0, 0);
    };
    oimg.src = (() => {
      const c = document.createElement('canvas');
      c.width = compareItem.imageData.width;
      c.height = compareItem.imageData.height;
      c.getContext('2d')?.putImageData(compareItem.imageData, 0, 0);
      return c.toDataURL('image/png');
    })();

    const resUrl = URL.createObjectURL(compareItem.resultBlob);
    const rimg = new Image();
    rimg.onload = () => {
      rcanvas.width = rimg.naturalWidth;
      rcanvas.height = rimg.naturalHeight;
      rcanvas.getContext('2d')?.drawImage(rimg, 0, 0);
      URL.revokeObjectURL(resUrl);
    };
    rimg.onerror = () => URL.revokeObjectURL(resUrl);
    rimg.src = resUrl;
  }, [compareItem]);

  const updateItem = useCallback((id: string, patch: Partial<UpscaleItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const updateSlider = (clientX: number) => {
    const s = stageRef.current;
    if (!s) return;
    const rect = s.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPct(Math.max(0, Math.min(100, pct)));
  };

  const onSliderDown = (e: React.PointerEvent<HTMLDivElement>) => {
    sliderDragRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    updateSlider(e.clientX);
  };

  const onSliderMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sliderDragRef.current) return;
    updateSlider(e.clientX);
  };

  const onSliderUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sliderDragRef.current) return;
    sliderDragRef.current = false;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  };

  const openCompare = (id: string) => {
    setSliderPct(50);
    setCompareId(id);
  };

  const getPipeline = useCallback(
    async (modelId: string): Promise<Pipeline> => {
      const cached = pipelineCache.current.get(modelId);
      if (cached) return cached;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — runtime CDN import
      const mod = await import(/* webpackIgnore: true */ TRANSFORMERS_CDN);
      const { pipeline, env } = mod;
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      const fileTotals = new Map<string, { loaded: number; total: number }>();
      let lastPct = 0;

      const pipe = (await pipeline('image-to-image', modelId, {
        progress_callback: (data: {
          status: string;
          name?: string;
          loaded?: number;
          total?: number;
        }) => {
          if (data.status === 'initiate' && data.name) {
            fileTotals.set(data.name, { loaded: 0, total: 0 });
          } else if (data.status === 'progress' && data.name) {
            fileTotals.set(data.name, {
              loaded: data.loaded ?? 0,
              total: data.total ?? 0,
            });
            const totals = Array.from(fileTotals.values());
            const sumLoaded = totals.reduce((s, f) => s + f.loaded, 0);
            const sumTotal = totals.reduce((s, f) => s + f.total, 0);
            if (sumTotal > 0) {
              const pct = Math.round((sumLoaded / sumTotal) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                setModelLoadPct(pct);
              }
            }
          }
        },
      })) as Pipeline;

      pipelineCache.current.set(modelId, pipe);
      setModelLoadPct(null);
      return pipe;
    },
    [],
  );

  const loadFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.error('No images found');
      return;
    }

    const cap = MAX_INPUT_DIM_BY_SCALE[scale] ?? 512;
    const newItems: UpscaleItem[] = [];
    for (const file of imageFiles) {
      try {
        const original = await fileToImageData(file);
        const { input, w, h } = downscaleIfNeeded(original, cap);
        newItems.push({
          id: crypto.randomUUID(),
          name: file.name,
          imageData: input,
          thumbnailUrl: makeThumbnail(input, 160),
          originalSize: file.size,
          originalWidth: original.width,
          originalHeight: original.height,
          inputWidth: w,
          inputHeight: h,
          resultBlob: null,
          resultUrl: null,
          resultSize: null,
          resultWidth: null,
          resultHeight: null,
          processing: false,
          processed: false,
        });
      } catch (err) {
        toast.error(`Couldn't read ${file.name}`);
        console.error(err);
      }
    }
    if (newItems.length === 0) return;

    const wasResized = newItems.some(
      (i) => i.inputWidth !== i.originalWidth || i.inputHeight !== i.originalHeight,
    );
    setItems((prev) => [...prev, ...newItems]);
    toast.success(
      `Added ${newItems.length} image${newItems.length > 1 ? 's' : ''}` +
        (wasResized ? ` — large images downscaled to ≤${cap} px before upscaling` : ''),
    );
  }, [scale]);

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

  const processItem = useCallback(
    async (item: UpscaleItem) => {
      const key = `${scale}-${mode}` as keyof typeof MODELS;
      const modelId = MODELS[key] ?? MODELS['2-photo'];

      updateItem(item.id, { processing: true, error: undefined });
      setActiveStatus(`Loading ${modelId.split('/').pop()}…`);

      try {
        const pipe = await getPipeline(modelId);
        setActiveStatus('Running inference…');

        const inputBlob = await imageDataToBlob(item.imageData, 'png', 100, null);
        if (!inputBlob) throw new Error('Could not encode input');
        const inputUrl = URL.createObjectURL(inputBlob);

        let raw: { data: Uint8Array; width: number; height: number };
        try {
          raw = await pipe(inputUrl);
        } finally {
          URL.revokeObjectURL(inputUrl);
        }

        const rgba = new Uint8ClampedArray(raw.width * raw.height * 4);
        for (let i = 0, n = raw.width * raw.height; i < n; i++) {
          rgba[i * 4] = raw.data[i * 3];
          rgba[i * 4 + 1] = raw.data[i * 3 + 1];
          rgba[i * 4 + 2] = raw.data[i * 3 + 2];
          rgba[i * 4 + 3] = 255;
        }
        const resultData = new ImageData(rgba, raw.width, raw.height);
        const resultBlob = await imageDataToBlob(resultData, 'png', 100, null);
        if (!resultBlob) throw new Error('Could not encode result');

        const resultUrl = URL.createObjectURL(resultBlob);
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== item.id) return it;
            if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
            return {
              ...it,
              resultBlob,
              resultUrl,
              resultSize: resultBlob.size,
              resultWidth: raw.width,
              resultHeight: raw.height,
              processing: false,
              processed: true,
            };
          }),
        );
        setActiveStatus(null);
      } catch (err) {
        console.error(err);
        setActiveStatus(null);
        updateItem(item.id, {
          processing: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
        throw err;
      }
    },
    [scale, mode, getPipeline, updateItem],
  );

  const runActive = async (item: UpscaleItem) => {
    try {
      await processItem(item);
      toast.success('Upscaled');
    } catch {
      toast.error('Upscale failed');
    }
  };

  const runAll = async () => {
    const pending = items.filter((i) => !i.processed && !i.processing);
    if (pending.length === 0) {
      toast.error('Nothing to upscale');
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
    toast.success(`Upscaled ${ok} of ${pending.length}`);
  };

  const downloadItem = (item: UpscaleItem) => {
    if (!item.resultBlob) return;
    const base = item.name.replace(/\.[^.]+$/, '');
    triggerDownload(item.resultBlob, `${base}-${scale}x.png`);
  };

  const downloadAllZip = async () => {
    const ready = items.filter((i) => i.resultBlob);
    if (ready.length === 0) {
      toast.error('Nothing upscaled yet');
      return;
    }
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const item of ready) {
        const base = item.name.replace(/\.[^.]+$/, '');
        zip.file(`${base}-${scale}x.png`, item.resultBlob!);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      triggerDownload(out, `upscaled-${scale}x.zip`);
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
            On-device super-resolution — nothing uploaded
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
            Upscale &amp; enhance
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
            Run a swin2SR super-resolution model in your browser. First use of each model downloads ~50 MB and is cached after.
          </p>
        </header>

        {modelLoadPct != null && (
          <Card className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
            <div className="flex items-center gap-3 p-4">
              <ZoomIn className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
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
                  One-time download per model. Cached for next visits.
                </p>
              </div>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="grid gap-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-2 sm:p-5">
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-600 dark:text-slate-400">Scale</span>
              <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                {([2, 4] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setScale(s);
                      if (s === 2) setMode('photo');
                    }}
                    disabled={batchRunning}
                    className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                      scale === s
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-600 dark:text-slate-400">
                Model {scale === 2 ? '(only Photo at 2×)' : ''}
              </span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
                disabled={scale === 2 || batchRunning}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="photo">Photo — general real-world images</option>
                <option value="compressed">JPEG cleanup — for compressed photos</option>
              </select>
            </div>
          </div>

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
                  Drop images here
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Large images are auto-downscaled to fit in browser memory: ≤768 px for 2×, ≤384 px for 4×.
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
                <div className="flex flex-wrap items-center gap-2">
                  {activeStatus && (
                    <span className="text-xs text-slate-500">{activeStatus}</span>
                  )}
                  <Button
                    size="lg"
                    onClick={runAll}
                    disabled={batchRunning || pendingCount === 0}
                    className="min-w-[180px]"
                  >
                    <Wand2 className="mr-2 h-4 w-4" />
                    {batchRunning ? 'Upscaling…' : `Upscale all (${pendingCount})`}
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
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {item.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                        <span>
                          {item.inputWidth}×{item.inputHeight}
                        </span>
                        {item.resultWidth && item.resultHeight && (
                          <>
                            <ArrowRight className="h-3 w-3 text-slate-400" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {item.resultWidth}×{item.resultHeight}
                            </span>
                            {item.resultSize != null && (
                              <span className="text-slate-500">
                                · {formatBytes(item.resultSize)}
                              </span>
                            )}
                          </>
                        )}
                        {item.inputWidth !== item.originalWidth && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            from {item.originalWidth}×{item.originalHeight}
                          </span>
                        )}
                      </div>
                      {item.processing && (
                        <div className="mt-2 text-xs text-slate-500">
                          Running {scale}× model…
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
                          {item.processing ? 'Working…' : 'Upscale'}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openCompare(item.id)}
                          >
                            <GitCompareArrows className="mr-1.5 h-4 w-4" />
                            Compare
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => downloadItem(item)}
                          >
                            <Download className="mr-1.5 h-4 w-4" />
                            Download
                          </Button>
                        </>
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
          Real-ESRGAN-style models run on CPU via WebAssembly. Expect 10–60 s per image. Cached after first download.
        </p>
      </div>

      {compareItem && compareItem.resultBlob && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 sm:p-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCompareId(null);
          }}
        >
          <div className="flex w-full max-w-5xl items-center justify-between gap-4 text-white">
            <div className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{compareItem.name}</span>
              <span className="ml-3 text-white/70 tabular-nums">
                {compareItem.inputWidth}×{compareItem.inputHeight} → {compareItem.resultWidth}×
                {compareItem.resultHeight}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCompareId(null)}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              aria-label="Close compare view"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div
            ref={stageRef}
            className="relative inline-block max-h-[80vh] max-w-full select-none overflow-hidden rounded bg-black"
            style={{ cursor: 'ew-resize', touchAction: 'none' }}
            onPointerDown={onSliderDown}
            onPointerMove={onSliderMove}
            onPointerUp={onSliderUp}
            onPointerCancel={onSliderUp}
          >
            <canvas
              ref={resultCanvasRef}
              className="block h-auto max-h-[80vh] w-auto max-w-full"
            />
            <canvas
              ref={originalCanvasRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              style={{ left: `${sliderPct}%` }}
            />
            <div
              className="pointer-events-none absolute flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/20"
              style={{
                left: `${sliderPct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="flex gap-1">
                <span className="block h-3 w-0.5 bg-slate-400" />
                <span className="block h-3 w-0.5 bg-slate-400" />
              </div>
            </div>
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
              Original (upscaled in browser)
            </span>
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
              {scale}× SR
            </span>
          </div>
          <p className="text-xs text-white/60">
            Drag the divider · click outside or press Esc to close
          </p>
        </div>
      )}
    </div>
  );
}

function downscaleIfNeeded(
  data: ImageData,
  maxDim: number,
): { input: ImageData; w: number; h: number } {
  const longest = Math.max(data.width, data.height);
  if (longest <= maxDim) return { input: data, w: data.width, h: data.height };
  const scale = maxDim / longest;
  const w = Math.max(1, Math.round(data.width * scale));
  const h = Math.max(1, Math.round(data.height * scale));
  const src = document.createElement('canvas');
  src.width = data.width;
  src.height = data.height;
  src.getContext('2d')?.putImageData(data, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const dctx = dst.getContext('2d');
  if (!dctx) return { input: data, w: data.width, h: data.height };
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(src, 0, 0, w, h);
  return { input: dctx.getImageData(0, 0, w, h), w, h };
}
