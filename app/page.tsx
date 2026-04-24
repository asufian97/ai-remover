'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileArchive,
  GitCompareArrows,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { runInpaint } from '@/lib/inpaint-client';

type Rect = { x: number; y: number; w: number; h: number };

type Item = {
  id: string;
  name: string;
  originalData: ImageData;
  workingData: ImageData;
  selection: Rect | null;
  processed: boolean;
  processing: boolean;
  progress: number;
  thumbnailUrl: string;
  error?: string;
};

type ExportFormat = 'png' | 'jpeg' | 'webp';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const sliderDragRef = useRef(false);

  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPct, setSliderPct] = useState(50);
  const [isDragOver, setIsDragOver] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [zipping, setZipping] = useState(false);

  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportQuality, setExportQuality] = useState(90);
  const [maxDimension, setMaxDimension] = useState<number>(0);
  const [showSettings, setShowSettings] = useState(false);

  const active = useMemo(
    () => items.find((i) => i.id === activeId) ?? null,
    [items, activeId],
  );

  const updateItem = useCallback((id: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !active) return;
    if (c.width !== active.workingData.width || c.height !== active.workingData.height) {
      c.width = active.workingData.width;
      c.height = active.workingData.height;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(active.workingData, 0, 0);
    const sel = active.selection;
    if (!compareMode && !active.processing && sel && sel.w > 1 && sel.h > 1) {
      const stroke = Math.max(2, c.width / 500);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = stroke;
      ctx.setLineDash([stroke * 4, stroke * 3]);
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
    }
  }, [active, compareMode]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!compareMode || !active) return;
    const c = originalCanvasRef.current;
    if (!c) return;
    c.width = active.originalData.width;
    c.height = active.originalData.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(active.originalData, 0, 0);
  }, [compareMode, active]);

  const loadFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        toast.error('No images found');
        return;
      }

      const newItems: Item[] = [];
      for (const file of imageFiles) {
        try {
          const data = await fileToImageData(file);
          const w = data.width;
          const h = data.height;
          const boxW = Math.round(w * 0.2);
          const boxH = Math.round(h * 0.1);
          newItems.push({
            id: crypto.randomUUID(),
            name: file.name,
            originalData: data,
            workingData: new ImageData(new Uint8ClampedArray(data.data), w, h),
            selection: {
              x: w - boxW - Math.round(w * 0.015),
              y: h - boxH - Math.round(h * 0.015),
              w: boxW,
              h: boxH,
            },
            processed: false,
            processing: false,
            progress: 0,
            thumbnailUrl: makeThumbnail(data, 160),
          });
        } catch (err) {
          toast.error(`Couldn't read ${file.name}`);
          console.error(err);
        }
      }

      if (newItems.length === 0) return;
      setItems((prev) => [...prev, ...newItems]);
      setActiveId((prev) => prev ?? newItems[0].id);
      setCompareMode(false);
      toast.success(`Added ${newItems.length} image${newItems.length > 1 ? 's' : ''}`);
    },
    [],
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

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: Math.round(((clientX - rect.left) / rect.width) * c.width),
      y: Math.round(((clientY - rect.top) / rect.height) * c.height),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || active.processing || compareMode) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = toCanvasCoords(e.clientX, e.clientY);
    drawStartRef.current = p;
    updateItem(active.id, { selection: { x: p.x, y: p.y, w: 0, h: 0 } });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawStartRef.current || !active) return;
    const p = toCanvasCoords(e.clientX, e.clientY);
    const s = drawStartRef.current;
    updateItem(active.id, {
      selection: {
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      },
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawStartRef.current) return;
    (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    drawStartRef.current = null;
  };

  const updateSlider = (clientX: number) => {
    const s = stageRef.current;
    if (!s) return;
    const rect = s.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPct(Math.max(0, Math.min(100, pct)));
  };

  const onSliderDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!compareMode) return;
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

  const processItem = useCallback(
    async (item: Item) => {
      if (!item.selection || item.selection.w < 2 || item.selection.h < 2) return;
      updateItem(item.id, { processing: true, progress: 1, error: undefined });

      const w = item.workingData.width;
      const h = item.workingData.height;
      const mask = new Uint8Array(w * h);
      const x0 = Math.max(0, item.selection.x);
      const y0 = Math.max(0, item.selection.y);
      const x1 = Math.min(w, item.selection.x + item.selection.w);
      const y1 = Math.min(h, item.selection.y + item.selection.h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          mask[y * w + x] = 1;
        }
      }

      try {
        const result = await runInpaint(item.workingData, mask, (pct) => {
          updateItem(item.id, { progress: Math.max(1, Math.round(pct)) });
        });
        updateItem(item.id, {
          workingData: result,
          processed: true,
          processing: false,
          progress: 0,
          selection: null,
          thumbnailUrl: makeThumbnail(result, 160),
        });
      } catch (err) {
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

  const runActive = async () => {
    if (!active) return;
    try {
      await processItem(active);
      toast.success('Watermark removed');
    } catch (err) {
      toast.error('Something went wrong');
      console.error(err);
    }
  };

  const runAll = async () => {
    const pending = items.filter(
      (i) => i.selection && i.selection.w >= 2 && i.selection.h >= 2,
    );
    if (pending.length === 0) {
      toast.error('No images with a selection to process');
      return;
    }
    setBatchRunning(true);
    let ok = 0;
    for (const item of pending) {
      try {
        await processItem(item);
        ok++;
      } catch {
        // per-item error already recorded
      }
    }
    setBatchRunning(false);
    toast.success(`Processed ${ok} of ${pending.length}`);
  };

  const applyActiveSelectionToAll = () => {
    if (!active || !active.selection) return;
    const src = active;
    const srcSel = src.selection!;
    const rx = srcSel.x / src.workingData.width;
    const ry = srcSel.y / src.workingData.height;
    const rw = srcSel.w / src.workingData.width;
    const rh = srcSel.h / src.workingData.height;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === src.id) return it;
        const w = it.workingData.width;
        const h = it.workingData.height;
        return {
          ...it,
          selection: {
            x: Math.round(rx * w),
            y: Math.round(ry * h),
            w: Math.round(rw * w),
            h: Math.round(rh * h),
          },
        };
      }),
    );
    toast.success('Box applied to every image');
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (activeId === id) {
        setActiveId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  };

  const resetAll = () => {
    setItems([]);
    setActiveId(null);
    setCompareMode(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadActive = async () => {
    if (!active) return;
    const blob = await imageDataToBlob(
      active.workingData,
      exportFormat,
      exportQuality,
      maxDimension || null,
    );
    if (!blob) {
      toast.error('Export failed');
      return;
    }
    triggerDownload(blob, makeExportName(active.name, exportFormat));
  };

  const downloadAllZip = async () => {
    const ready = items.filter((i) => i.processed);
    if (ready.length === 0) {
      toast.error('Nothing processed yet');
      return;
    }
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const item of ready) {
        const blob = await imageDataToBlob(
          item.workingData,
          exportFormat,
          exportQuality,
          maxDimension || null,
        );
        if (!blob) continue;
        zip.file(makeExportName(item.name, exportFormat), blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      triggerDownload(out, 'cleaned.zip');
      toast.success(`Zipped ${ready.length} image${ready.length > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error('Zip failed');
      console.error(err);
    } finally {
      setZipping(false);
    }
  };

  const toggleCompare = () => {
    if (!active?.processed) return;
    setCompareMode((v) => {
      const next = !v;
      if (next) setSliderPct(50);
      return next;
    });
  };

  const pendingCount = items.filter(
    (i) => i.selection && i.selection.w >= 2 && i.selection.h >= 2 && !i.processing,
  ).length;
  const processedCount = items.filter((i) => i.processed).length;

  const canRunActive =
    !!active &&
    !active.processing &&
    !compareMode &&
    !!active.selection &&
    active.selection.w >= 2 &&
    active.selection.h >= 2;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
        <header className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <Sparkles className="h-3.5 w-3.5" />
            Runs entirely in your browser
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
            Remove the Gemini watermark
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
            Batch-process multiple images, compare before/after, export as PNG/JPEG/WebP or a single zip.
          </p>
        </header>

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
                  Drop images here
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  or click to browse — PNG, JPG, WebP. Multiple files allowed.
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
            <div className="flex flex-col">
              <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:flex-row sm:items-center sm:justify-between sm:p-5">
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={applyActiveSelectionToAll}
                    disabled={!active?.selection || items.length < 2 || batchRunning}
                  >
                    Apply box to all
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
                    className="min-w-[160px]"
                  >
                    <Zap className="mr-2 h-4 w-4" />
                    {batchRunning ? 'Running…' : `Remove all (${pendingCount})`}
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={downloadAllZip}
                    disabled={processedCount === 0 || zipping || batchRunning}
                    className="min-w-[160px]"
                  >
                    <FileArchive className="mr-2 h-4 w-4" />
                    {zipping ? 'Zipping…' : `Download zip (${processedCount})`}
                  </Button>
                </div>
              </div>

              <div className="border-b border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSettings((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900 sm:px-5"
                >
                  <span>Export settings — {exportFormat.toUpperCase()}
                    {exportFormat !== 'png' ? `, quality ${exportQuality}` : ''}
                    {maxDimension ? `, max ${maxDimension}px` : ''}
                  </span>
                  {showSettings ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                {showSettings && (
                  <div className="grid gap-4 px-4 pb-4 sm:grid-cols-3 sm:px-5">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-slate-600 dark:text-slate-400">Format</span>
                      <select
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="png">PNG (lossless)</option>
                        <option value="jpeg">JPEG (smaller)</option>
                        <option value="webp">WebP (smallest)</option>
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
                        <option value={2048}>2048 px</option>
                        <option value={4096}>4096 px</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr]">
                <aside className="max-h-[80vh] overflow-y-auto border-b border-slate-200 p-3 dark:border-slate-800 lg:max-h-none lg:border-b-0 lg:border-r">
                  <div className="flex flex-col gap-2">
                    {items.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => {
                          setActiveId(it.id);
                          setCompareMode(false);
                        }}
                        className={`group relative flex items-center gap-3 rounded-md border p-2 text-left transition-colors ${
                          it.id === activeId
                            ? 'border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800'
                            : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={it.thumbnailUrl}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                            {it.name}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {it.processing
                              ? `Processing ${it.progress}%`
                              : it.error
                              ? 'Error'
                              : it.processed
                              ? 'Done'
                              : it.selection
                              ? 'Ready'
                              : 'No box'}
                          </div>
                          {it.processing && (
                            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                              <div
                                className="h-full bg-slate-900 transition-[width] dark:bg-slate-100"
                                style={{ width: `${it.progress}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeItem(it.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              removeItem(it.id);
                            }
                          }}
                          className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                          aria-label={`Remove ${it.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    ))}
                  </div>
                </aside>

                <div className="flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 text-sm dark:border-slate-800 sm:px-5">
                    <div className="flex-1 text-slate-600 dark:text-slate-400">
                      {active ? (
                        active.processing ? (
                          <div className="flex items-center gap-3">
                            <span className="w-28 shrink-0 tabular-nums">
                              Processing… {active.progress}%
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div
                                className="h-full bg-slate-900 transition-[width] duration-150 ease-out dark:bg-slate-100"
                                style={{ width: `${active.progress}%` }}
                              />
                            </div>
                          </div>
                        ) : compareMode ? (
                          <span>Drag the divider to compare original vs cleaned.</span>
                        ) : active.processed ? (
                          <span>
                            Done. Draw another box to clean more spots, or toggle <b>Before / after</b>.
                          </span>
                        ) : (
                          <span>
                            Drag a box over the watermark, then click <b>Remove</b>.
                          </span>
                        )
                      ) : (
                        <span>Select an image on the left.</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={compareMode ? 'default' : 'outline'}
                        size="sm"
                        disabled={!active?.processed || (active?.processing ?? false)}
                        onClick={toggleCompare}
                      >
                        <GitCompareArrows className="mr-1.5 h-4 w-4" />
                        {compareMode ? 'Exit compare' : 'Before / after'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={runActive}
                        disabled={!canRunActive || batchRunning}
                      >
                        <Wand2 className="mr-1.5 h-4 w-4" />
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={downloadActive}
                        disabled={!active?.processed || (active?.processing ?? false)}
                      >
                        <Download className="mr-1.5 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>

                  <div className="canvas-stage flex justify-center overflow-auto p-4 sm:p-5">
                    {active ? (
                      <div
                        ref={stageRef}
                        className="relative inline-block select-none"
                        onPointerDown={onSliderDown}
                        onPointerMove={onSliderMove}
                        onPointerUp={onSliderUp}
                        onPointerCancel={onSliderUp}
                      >
                        <canvas
                          ref={canvasRef}
                          className="block h-auto max-h-[70vh] w-auto max-w-full touch-none select-none rounded shadow-sm"
                          style={{
                            cursor: compareMode
                              ? 'ew-resize'
                              : active.processing
                              ? 'default'
                              : 'crosshair',
                          }}
                          onPointerDown={onPointerDown}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          onPointerCancel={onPointerUp}
                        />
                        {compareMode && (
                          <>
                            <canvas
                              ref={originalCanvasRef}
                              className="pointer-events-none absolute inset-0 h-full w-full rounded"
                              style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
                            />
                            <div
                              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
                              style={{ left: `${sliderPct}%` }}
                            />
                            <div
                              className="pointer-events-none absolute flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/10"
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
                            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                              Original
                            </span>
                            <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                              Cleaned
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="py-20 text-center text-sm text-slate-500">
                        No image selected.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
          Tip: smaller, tighter boxes produce cleaner fills. Only remove watermarks from images you own.
        </p>
      </div>
    </main>
  );
}

function fileToImageData(file: File): Promise<ImageData> {
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

function makeThumbnail(data: ImageData, maxSize: number): string {
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

async function imageDataToBlob(
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
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const q = format === 'png' ? undefined : quality / 100;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, q);
  });
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function makeExportName(originalName: string, format: ExportFormat): string {
  const dot = originalName.lastIndexOf('.');
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `${base}-cleaned.${ext}`;
}
