'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ArchiveRestore,
  ArrowRight,
  Download,
  FileArchive,
  GitCompareArrows,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fileToImageData,
  formatBytes,
  imageDataToBlob,
  makeExportName,
  makeThumbnail,
  triggerDownload,
  type ExportFormat,
} from '@/lib/image-utils';

type CompressItem = {
  id: string;
  name: string;
  imageData: ImageData;
  thumbnailUrl: string;
  originalSize: number;
  originalWidth: number;
  originalHeight: number;
  compressedSize: number | null;
  compressedBlob: Blob | null;
  computing: boolean;
  error?: string;
};

export default function CompressPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<CompressItem[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const compressedCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const sliderDragRef = useRef(false);

  const [items, setItems] = useState<CompressItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [zipping, setZipping] = useState(false);

  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');
  const [exportQuality, setExportQuality] = useState(80);
  const [maxDimension, setMaxDimension] = useState<number>(0);

  const [compareId, setCompareId] = useState<string | null>(null);
  const [sliderPct, setSliderPct] = useState(50);

  const compareItem = compareId
    ? items.find((i) => i.id === compareId) ?? null
    : null;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!compareId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompareId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compareId]);

  useEffect(() => {
    if (!compareItem || !compareItem.compressedBlob) return;
    const ocanvas = originalCanvasRef.current;
    const ccanvas = compressedCanvasRef.current;
    if (!ocanvas || !ccanvas) return;

    ocanvas.width = compareItem.imageData.width;
    ocanvas.height = compareItem.imageData.height;
    ocanvas.getContext('2d')?.putImageData(compareItem.imageData, 0, 0);

    const url = URL.createObjectURL(compareItem.compressedBlob);
    const img = new Image();
    img.onload = () => {
      ccanvas.width = img.naturalWidth;
      ccanvas.height = img.naturalHeight;
      ccanvas.getContext('2d')?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [compareItem]);

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

  const updateItem = useCallback((id: string, patch: Partial<CompressItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const compressItem = useCallback(
    async (item: CompressItem, format: ExportFormat, quality: number, maxDim: number) => {
      updateItem(item.id, { computing: true, error: undefined });
      try {
        const blob = await imageDataToBlob(
          item.imageData,
          format,
          quality,
          maxDim || null,
        );
        if (!blob) {
          updateItem(item.id, { computing: false, error: 'Compression failed' });
          return;
        }
        updateItem(item.id, {
          compressedBlob: blob,
          compressedSize: blob.size,
          computing: false,
        });
      } catch (err) {
        updateItem(item.id, {
          computing: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
      }
    },
    [updateItem],
  );

  useEffect(() => {
    const snapshot = itemsRef.current;
    if (snapshot.length === 0) return;
    const t = setTimeout(() => {
      (async () => {
        for (const item of snapshot) {
          await compressItem(item, exportFormat, exportQuality, maxDimension);
        }
      })();
    }, 250);
    return () => clearTimeout(t);
  }, [exportFormat, exportQuality, maxDimension, compressItem]);

  const loadFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        toast.error('No images found');
        return;
      }

      const newItems: CompressItem[] = [];
      for (const file of imageFiles) {
        try {
          const data = await fileToImageData(file);
          newItems.push({
            id: crypto.randomUUID(),
            name: file.name,
            imageData: data,
            thumbnailUrl: makeThumbnail(data, 160),
            originalSize: file.size,
            originalWidth: data.width,
            originalHeight: data.height,
            compressedSize: null,
            compressedBlob: null,
            computing: true,
          });
        } catch (err) {
          toast.error(`Couldn't read ${file.name}`);
          console.error(err);
        }
      }

      if (newItems.length === 0) return;
      setItems((prev) => [...prev, ...newItems]);

      for (const item of newItems) {
        await compressItem(item, exportFormat, exportQuality, maxDimension);
      }
    },
    [compressItem, exportFormat, exportQuality, maxDimension],
  );

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
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const resetAll = () => {
    setItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadItem = (item: CompressItem) => {
    if (!item.compressedBlob) return;
    triggerDownload(
      item.compressedBlob,
      makeExportName(item.name, exportFormat, '-compressed'),
    );
  };

  const downloadAllZip = async () => {
    const ready = items.filter((i) => i.compressedBlob);
    if (ready.length === 0) {
      toast.error('Nothing to download yet');
      return;
    }
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const item of ready) {
        zip.file(makeExportName(item.name, exportFormat, '-compressed'), item.compressedBlob!);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      triggerDownload(out, 'compressed.zip');
      toast.success(`Zipped ${ready.length} image${ready.length > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error('Zip failed');
      console.error(err);
    } finally {
      setZipping(false);
    }
  };

  const totalOriginal = items.reduce((s, i) => s + i.originalSize, 0);
  const totalCompressed = items.reduce((s, i) => s + (i.compressedSize ?? 0), 0);
  const anyComputing = items.some((i) => i.computing);
  const savingsPct =
    totalOriginal > 0 && totalCompressed > 0
      ? Math.max(0, Math.round(((totalOriginal - totalCompressed) / totalOriginal) * 100))
      : 0;

  return (
    <div className="w-full">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <header className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <ArchiveRestore className="h-3.5 w-3.5" />
            No upload — compression runs in your browser
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
            Compress images
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
            Shrink JPEGs, PNGs, and WebPs. Pick a format, quality, and optional size cap — download any file or the whole batch as a zip.
          </p>
        </header>

        <Card className="overflow-hidden">
          <div className="grid gap-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-3 sm:p-5">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-400">Format</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="jpeg">JPEG (smaller)</option>
                <option value="webp">WebP (smallest)</option>
                <option value="png">PNG (lossless)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span>Quality</span>
                <span className="tabular-nums text-slate-500">
                  {exportFormat === 'png' ? 'N/A' : exportQuality}
                </span>
              </span>
              <input
                type="range"
                min={30}
                max={100}
                step={1}
                value={exportQuality}
                onChange={(e) => setExportQuality(Number(e.target.value))}
                disabled={exportFormat === 'png'}
                className="h-2 accent-slate-900 dark:accent-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-400">Max dimension</span>
              <select
                value={maxDimension}
                onChange={(e) => setMaxDimension(Number(e.target.value))}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value={0}>Original size</option>
                <option value={1024}>1024 px (longest side)</option>
                <option value={1600}>1600 px</option>
                <option value={2048}>2048 px</option>
                <option value={4096}>4096 px</option>
              </select>
            </label>
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
                  or click to browse. Multiple files allowed.
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
                    disabled={zipping}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add images
                  </Button>
                  <Button variant="outline" size="sm" onClick={resetAll} disabled={zipping}>
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
                <div className="flex items-center gap-4">
                  {totalCompressed > 0 && (
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatBytes(totalOriginal)}
                      </span>
                      <span className="mx-2">→</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatBytes(totalCompressed)}
                      </span>
                      {savingsPct > 0 && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          −{savingsPct}%
                        </span>
                      )}
                    </div>
                  )}
                  <Button
                    size="lg"
                    onClick={downloadAllZip}
                    disabled={zipping || anyComputing || items.every((i) => !i.compressedBlob)}
                    className="min-w-[180px]"
                  >
                    <FileArchive className="mr-2 h-4 w-4" />
                    {zipping ? 'Zipping…' : 'Download all (zip)'}
                  </Button>
                </div>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((item) => {
                  const savings =
                    item.compressedSize != null && item.originalSize > 0
                      ? Math.max(
                          0,
                          Math.round(
                            ((item.originalSize - item.compressedSize) / item.originalSize) * 100,
                          ),
                        )
                      : 0;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 p-3 sm:p-4"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {item.name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-slate-500">
                            {item.originalWidth}×{item.originalHeight}
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-500 tabular-nums">
                            {formatBytes(item.originalSize)}
                          </span>
                          <ArrowRight className="h-3 w-3 text-slate-400" />
                          {item.computing ? (
                            <span className="text-slate-500">Computing…</span>
                          ) : item.error ? (
                            <span className="text-red-600 dark:text-red-400">{item.error}</span>
                          ) : item.compressedSize != null ? (
                            <>
                              <span className="font-medium text-slate-900 tabular-nums dark:text-slate-100">
                                {formatBytes(item.compressedSize)}
                              </span>
                              {savings > 0 && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                  −{savings}%
                                </span>
                              )}
                            </>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openCompare(item.id)}
                        disabled={!item.compressedBlob || item.computing}
                      >
                        <GitCompareArrows className="mr-1.5 h-4 w-4" />
                        Compare
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => downloadItem(item)}
                        disabled={!item.compressedBlob || item.computing}
                      >
                        <Download className="mr-1.5 h-4 w-4" />
                        Download
                      </Button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
          All compression happens locally. Your images never leave your browser.
        </p>
      </div>

      {compareItem && compareItem.compressedBlob && (
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
                {formatBytes(compareItem.originalSize)} →{' '}
                {formatBytes(compareItem.compressedSize ?? 0)}
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
              ref={compressedCanvasRef}
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
              Original · {compareItem.originalWidth}×{compareItem.originalHeight}
            </span>
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
              Compressed
            </span>
          </div>
          <p className="text-xs text-white/60">Drag the divider · click outside or press Esc to close</p>
        </div>
      )}
    </div>
  );
}
