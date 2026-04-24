'use client';

import { useCallback, useRef, useState } from 'react';
import JSZip from 'jszip';
import ExifReader from 'exifreader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Download,
  FileArchive,
  MapPin,
  Plus,
  RotateCcw,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
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

type ExifSummary = {
  camera?: string;
  lens?: string;
  dateTaken?: string;
  gps?: { lat: number; lon: number } | null;
  software?: string;
  tagCount: number;
};

type MetaItem = {
  id: string;
  name: string;
  imageData: ImageData;
  thumbnailUrl: string;
  originalSize: number;
  exif: ExifSummary;
  cleanedBlob: Blob | null;
  cleanedSize: number | null;
  computing: boolean;
  error?: string;
};

export default function MetadataPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<MetaItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportQuality] = useState(95);

  const updateItem = useCallback((id: string, patch: Partial<MetaItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const cleanItem = useCallback(
    async (item: MetaItem, format: ExportFormat) => {
      updateItem(item.id, { computing: true, error: undefined });
      try {
        const blob = await imageDataToBlob(item.imageData, format, 95, null);
        if (!blob) {
          updateItem(item.id, { computing: false, error: 'Re-encode failed' });
          return;
        }
        updateItem(item.id, {
          cleanedBlob: blob,
          cleanedSize: blob.size,
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

  const loadFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        toast.error('No images found');
        return;
      }

      const newItems: MetaItem[] = [];
      for (const file of imageFiles) {
        try {
          const [data, exif] = await Promise.all([
            fileToImageData(file),
            readExif(file),
          ]);
          newItems.push({
            id: crypto.randomUUID(),
            name: file.name,
            imageData: data,
            thumbnailUrl: makeThumbnail(data, 160),
            originalSize: file.size,
            exif,
            cleanedBlob: null,
            cleanedSize: null,
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
        await cleanItem(item, exportFormat);
      }
    },
    [cleanItem, exportFormat],
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

  const downloadItem = (item: MetaItem) => {
    if (!item.cleanedBlob) return;
    triggerDownload(
      item.cleanedBlob,
      makeExportName(item.name, exportFormat, '-clean'),
    );
  };

  const downloadAllZip = async () => {
    const ready = items.filter((i) => i.cleanedBlob);
    if (ready.length === 0) {
      toast.error('Nothing cleaned yet');
      return;
    }
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const item of ready) {
        zip.file(makeExportName(item.name, exportFormat, '-clean'), item.cleanedBlob!);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      triggerDownload(out, 'metadata-stripped.zip');
      toast.success(`Zipped ${ready.length} image${ready.length > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error('Zip failed');
      console.error(err);
    } finally {
      setZipping(false);
    }
  };

  const changeFormat = async (format: ExportFormat) => {
    setExportFormat(format);
    for (const item of items) {
      await cleanItem(item, format);
    }
  };

  const anyComputing = items.some((i) => i.computing);
  const withGps = items.filter((i) => i.exif.gps).length;

  return (
    <div className="w-full">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <header className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <Shield className="h-3.5 w-3.5" />
            Strip GPS, camera, and other EXIF data
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
            Clean metadata
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
            Photos often carry your GPS location, camera model, and timestamps. Drop yours in to see what&apos;s there — download a clean version with nothing attached.
          </p>
        </header>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-600 dark:text-slate-400">Output format</span>
              <select
                value={exportFormat}
                onChange={(e) => changeFormat(e.target.value as ExportFormat)}
                disabled={anyComputing}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="png">PNG (lossless)</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            {items.length > 0 && withGps > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                <MapPin className="h-3.5 w-3.5" />
                {withGps} {withGps === 1 ? 'image has' : 'images have'} GPS location
              </span>
            )}
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
                  Drop photos here
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  JPEG, PNG, WebP. We&apos;ll show the metadata we find and hand back clean files.
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
                <Button
                  size="lg"
                  onClick={downloadAllZip}
                  disabled={zipping || anyComputing || items.every((i) => !i.cleanedBlob)}
                  className="min-w-[200px]"
                >
                  <FileArchive className="mr-2 h-4 w-4" />
                  {zipping ? 'Zipping…' : 'Download clean (zip)'}
                </Button>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:p-4">
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
                      <div className="mt-0.5 text-xs text-slate-500">
                        {formatBytes(item.originalSize)}
                        {item.cleanedSize != null && (
                          <>
                            <span className="mx-1.5">→</span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {formatBytes(item.cleanedSize)}
                            </span>
                          </>
                        )}
                      </div>
                      <ExifChips exif={item.exif} />
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-start">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => downloadItem(item)}
                        disabled={!item.cleanedBlob || item.computing}
                      >
                        <Download className="mr-1.5 h-4 w-4" />
                        {item.computing ? 'Cleaning…' : 'Download'}
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
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
          We read EXIF locally and strip it by re-encoding through canvas. Nothing is uploaded.
        </p>
      </div>
    </div>
  );
}

function ExifChips({ exif }: { exif: ExifSummary }) {
  if (exif.tagCount === 0) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" />
        No metadata detected
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
      {exif.gps && (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          <MapPin className="h-3 w-3" />
          {exif.gps.lat.toFixed(4)}, {exif.gps.lon.toFixed(4)}
        </span>
      )}
      {exif.camera && (
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {exif.camera}
        </span>
      )}
      {exif.lens && (
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {exif.lens}
        </span>
      )}
      {exif.dateTaken && (
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {exif.dateTaken}
        </span>
      )}
      {exif.software && (
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {exif.software}
        </span>
      )}
      <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        +{exif.tagCount} tag{exif.tagCount === 1 ? '' : 's'} total
      </span>
    </div>
  );
}

async function readExif(file: File): Promise<ExifSummary> {
  try {
    const tags = await ExifReader.load(file, { expanded: true });
    const exif = tags.exif || {};
    const gpsTags = tags.gps || {};
    const file0 = tags.file || {};

    const camera = [exif.Make?.description, exif.Model?.description]
      .filter(Boolean)
      .join(' ')
      .trim() || undefined;
    const lens = exif.LensModel?.description || undefined;
    const dateTaken = exif.DateTimeOriginal?.description || exif.DateTime?.description;
    const software = exif.Software?.description || undefined;

    let gps: { lat: number; lon: number } | null = null;
    const lat = gpsTags.Latitude as number | undefined;
    const lon = gpsTags.Longitude as number | undefined;
    if (typeof lat === 'number' && typeof lon === 'number') {
      gps = { lat, lon };
    }

    const countable = { ...exif, ...gpsTags, ...file0 };
    const tagCount = Object.keys(countable).length;

    return { camera, lens, dateTaken, gps, software, tagCount };
  } catch {
    return { tagCount: 0, gps: null };
  }
}
