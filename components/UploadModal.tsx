import React, { useState, useRef } from 'react';
import { Snapshot } from '../types.ts';
import { GenAiService } from '../services/genAiService.ts';
import { RateLimitService } from '../services/rateLimitService.ts';
import { coarsenCoordinate } from '../utils';
import Glyph from './Glyph';

/**
 * A tiny EXIF reader for JPEGs: just DateTimeOriginal and GPS, enough to say "Taken 3 Nov, near …".
 * Reads only the first 128 KB of the file and never throws. Coordinates are rounded to about 1 km
 * straight away, the same coarseness the live guide uses; exact GPS never leaves this function.
 */
export const readJpegExif = async (file: File): Promise<{ takenAtMs?: number; coarse?: { lat: number; lng: number } }> => {
  try {
    if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return {};
    const v = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return {};
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      // APP1 with the "Exif\0\0" header
      if (marker === 0xFFE1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
        const t = off + 10;
        const le = v.getUint16(t) === 0x4949;
        const u16 = (o: number) => v.getUint16(o, le);
        const u32 = (o: number) => v.getUint32(o, le);
        const entries = (ifd: number) => {
          const out = new Map<number, { type: number; count: number; at: number }>();
          if (ifd + 2 > v.byteLength) return out;
          const n = u16(ifd);
          for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            if (e + 12 > v.byteLength) break;
            out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
          }
          return out;
        };
        const ascii = (en?: { count: number; at: number }) => {
          if (!en) return '';
          const start = en.count > 4 ? t + u32(en.at) : en.at;
          let str = '';
          for (let i = 0; i < en.count && start + i < v.byteLength; i++) { const c = v.getUint8(start + i); if (!c) break; str += String.fromCharCode(c); }
          return str;
        };
        const rationals = (en?: { count: number; at: number }) => {
          if (!en) return [] as number[];
          const start = t + u32(en.at); const r: number[] = [];
          for (let i = 0; i < en.count && start + i * 8 + 8 <= v.byteLength; i++) { const d = u32(start + i * 8 + 4); r.push(d ? u32(start + i * 8) / d : 0); }
          return r;
        };
        const ifd0 = entries(t + u32(t + 4));
        const result: { takenAtMs?: number; coarse?: { lat: number; lng: number } } = {};
        const exifPtr = ifd0.get(0x8769);
        const exif = exifPtr ? entries(t + u32(exifPtr.at)) : new Map();
        const stamp = ascii(exif.get(0x9003)) || ascii(ifd0.get(0x0132));
        const m = stamp.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (m) {
          const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
          if (ms > 0 && ms <= Date.now() + 86_400_000) result.takenAtMs = ms;
        }
        const gpsPtr = ifd0.get(0x8825);
        if (gpsPtr) {
          const g = entries(t + u32(gpsPtr.at));
          const dms = (r: number[]) => r.length === 3 ? r[0] + r[1] / 60 + r[2] / 3600 : NaN;
          let lat = dms(rationals(g.get(0x0002))); let lng = dms(rationals(g.get(0x0004)));
          if (ascii(g.get(0x0001)) === 'S') lat = -lat;
          if (ascii(g.get(0x0003)) === 'W') lng = -lng;
          if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            result.coarse = { lat: coarsenCoordinate(lat), lng: coarsenCoordinate(lng) };
          }
        }
        return result;
      }
      off += 2 + size;
    }
  } catch { /* unreadable metadata is simply absent */ }
  return {};
};

/** Town-level name for coarse coordinates (the same lookup the review screen uses). */
const placeNear = async (c: { lat: number; lng: number }): Promise<string> => {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${c.lat}&lon=${c.lng}&zoom=10&addressdetails=1`);
    const a = (await res.json())?.address;
    return (a && (a.city || a.town || a.village || a.county || a.state)) || '';
  } catch { return ''; }
};

const takenLine = (it: { takenAtMs?: number; place?: string }) => {
  const d = it.takenAtMs ? new Date(it.takenAtMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(new Date(it.takenAtMs).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }) : '';
  if (d && it.place) return `Taken ${d}, near ${it.place}`;
  if (d) return `Taken ${d}`;
  if (it.place) return `Taken near ${it.place}`;
  return '';
};

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProcessUploads: (snapshots: Snapshot[], summary?: string) => void;
  userId: string;
}

interface UploadedFileItem {
  id: string;
  file: File;
  type: 'image' | 'video' | 'audio';
  previewUrl: string;
  duration?: number;
  error?: string;
  /** From the photo's own metadata, when it has any */
  takenAtMs?: number;
  coarse?: { lat: number; lng: number };
  place?: string;
}

/** The fields an upload brings from its metadata: a date to show, and only a coarse place. */
const metaFields = (it: UploadedFileItem): Partial<Snapshot> & { takenAtMs?: number } => ({
  ...(it.takenAtMs ? { takenAtMs: it.takenAtMs, timestamp: new Date(it.takenAtMs).toLocaleTimeString() } : {}),
  ...(it.coarse ? { location: it.place || `${it.coarse.lat},${it.coarse.lng}`, rawLocation: it.coarse } : {}),
});
const locationHint = (it?: UploadedFileItem) => it?.coarse ? (it.place || `${it.coarse.lat},${it.coarse.lng}`) : undefined;

export /** Map a governed AI result (or a failure) onto snapshot fields. Never invents labels or locations. */
const governedFields = (r: any): Pick<Snapshot, "labels" | "behavior" | "aiInsight"> & Partial<Snapshot> => r?.failed ? {
  labels: [], behavior: '', aiInsight: '', aiError: r.message || 'Identification unavailable right now',
} : {
  labels: r.taxonomy,
  behavior: r.ecologic,
  aiInsight: r.ecologic,
  aiProposedLabels: r.taxonomy,
  aiProposedBehavior: r.ecologic,
  aiConfidence: r.confidence,
  aiIdentifications: r.identifications,
  aiFlags: r.flags,
  needsExpertReview: r.needsExpertReview,
  aiSafetyNote: r.safetyNote,
  aiModel: r.model,
  aiPromptVersion: r.promptVersion,
  aiResultId: r.resultId,
  aiError: null,
};

const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  onProcessUploads,
  userId
}) => {
  const [items, setItems] = useState<UploadedFileItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [shouldStitch, setShouldStitch] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const validateAndAddFiles = async (files: FileList | File[]) => {
    setUploadError(null);
    const fileList = Array.from(files);

    if (!RateLimitService.canUpload(userId, fileList.length)) {
        setUploadError("That's today's uploads (3 batches or 15 files a day). Try again tomorrow.");
        return;
    }

    if (items.length + fileList.length > 5) {
      setUploadError("Up to 5 at a time. The first ones are in.");
    }

    const remainingSlots = 5 - items.length;
    if (remainingSlots <= 0) return;

    const filesToProcess = fileList.slice(0, remainingSlots);
    const newItems: UploadedFileItem[] = [];

    for (const file of filesToProcess) {
      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/');
      const isImage = file.type.startsWith('image/');

      if (!isImage && !isVideo && !isAudio) {
        setUploadError(`"${file.name}" isn't a photo, video or sound.`);
        continue;
      }

      const mediaType: 'image' | 'video' | 'audio' = isVideo ? 'video' : isAudio ? 'audio' : 'image';
      const previewUrl = URL.createObjectURL(file);

      if (isVideo || isAudio) {
        try {
          const media = isVideo ? document.createElement('video') : document.createElement('audio');
          media.src = previewUrl;

          const duration = await new Promise<number>((resolve) => {
            media.onloadedmetadata = () => resolve(media.duration);
            media.onerror = () => resolve(0);
          });

          if (duration > 30) {
            setUploadError(`"${file.name}" runs ${Math.round(duration)} seconds. Choose clips of 30 seconds or less.`);
            continue;
          }

          newItems.push({
            id: Math.random().toString(36).substr(2, 9),
            file,
            type: mediaType,
            previewUrl,
            duration: Math.round(duration)
          });
        } catch (e) {
          console.warn("Could not read media duration", e);
          newItems.push({
            id: Math.random().toString(36).substr(2, 9),
            file,
            type: mediaType,
            previewUrl
          });
        }
      } else {
        newItems.push({
          id: Math.random().toString(36).substr(2, 9),
          file,
          type: 'image',
          previewUrl
        });
      }
    }

    setItems(prev => [...prev, ...newItems]);

    // Read when and where each photo was taken, then name the town (never the exact spot)
    newItems.filter(i => i.type === 'image').forEach(async (it) => {
      const meta = await readJpegExif(it.file);
      if (!meta.takenAtMs && !meta.coarse) return;
      setItems(prev => prev.map(p => p.id === it.id ? { ...p, ...meta } : p));
      if (meta.coarse) {
        const place = await placeNear(meta.coarse);
        if (place) setItems(prev => prev.map(p => p.id === it.id ? { ...p, place } : p));
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAddFiles(e.target.files);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  const removeItem = (id: string) => {
    setItems(prev => {
      const filtered = prev.filter(item => item.id !== id);
      const removed = prev.find(item => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return filtered;
    });
  };

  const handleProcess = async () => {
    if (items.length === 0) return;

    setIsProcessing(true);
    setProcessingStatus("Looking closely at your sightings…");

    try {
      const processedSnapshots: Snapshot[] = [];
      const collectionItemsForSynthesis: { taxonomy: string[]; ecologic: string }[] = [];

      // Check if we can perform a multimodal combined analysis if stitched
      if (shouldStitch && items.length > 1) {
        setProcessingStatus("Your guide is looking at them together…");
        const imageItems = items.filter(i => i.type === 'image');
        const mediaItem = items.find(i => i.type === 'video' || i.type === 'audio');

        const imageBlobs = imageItems.map(i => i.file);
        const mediaBlob = mediaItem ? mediaItem.file : null;

        const result = await GenAiService.analyzeMultimodal(mediaBlob, imageBlobs, locationHint(items.find(i => i.coarse))).catch((e: any) => ({ failed: true, message: e?.message } as any));

        // Create a primary stitched snapshot plus associated files
        const primaryItem = mediaItem || items[0];
        const snapId = Date.now().toString();

        const stitchedSnapshot: Snapshot = {
          id: snapId,
          url: primaryItem.type === 'image' ? primaryItem.previewUrl : undefined,
          blob: primaryItem.type === 'image' ? primaryItem.file : undefined,
          videoUrl: primaryItem.type === 'video' ? primaryItem.previewUrl : undefined,
          videoBlob: primaryItem.type === 'video' ? primaryItem.file : undefined,
          audioUrl: primaryItem.type === 'audio' ? primaryItem.previewUrl : undefined,
          audioBlob: primaryItem.type === 'audio' ? primaryItem.file : undefined,
          timestamp: new Date().toLocaleTimeString(),
          ...governedFields(result),
          ...metaFields(items.find(i => i.takenAtMs || i.coarse) || primaryItem),
          type: primaryItem.type,
          userId,
          isHybrid: items.length > 1,
          associatedImages: imageItems.map(img => ({ url: img.previewUrl, blob: img.file })),
          isAnalyzing: false
        };

        processedSnapshots.push(stitchedSnapshot);
        if (!result.failed) collectionItemsForSynthesis.push({ taxonomy: result.taxonomy, ecologic: result.ecologic });
      } else {
        // Individual analysis per uploaded file
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          setProcessingStatus(items.length > 1 ? `Looking at ${i + 1} of ${items.length}…` : 'Looking closely…');

          // One file failing never blocks the others; the explorer labels it in review
          const result: any = await GenAiService.analyzeMedia(item.file, item.type, locationHint(item)).catch((e: any) => ({ failed: true, message: e?.message }));
          const snapId = (Date.now() + i).toString();

          const snapshot: Snapshot = {
            id: snapId,
            url: item.type === 'image' ? item.previewUrl : undefined,
            blob: item.type === 'image' ? item.file : undefined,
            videoUrl: item.type === 'video' ? item.previewUrl : undefined,
            videoBlob: item.type === 'video' ? item.file : undefined,
            audioUrl: item.type === 'audio' ? item.previewUrl : undefined,
            audioBlob: item.type === 'audio' ? item.file : undefined,
            timestamp: new Date().toLocaleTimeString(),
            ...governedFields(result),
            ...metaFields(item),
            type: item.type,
            userId,
            isHybrid: false,
            isAnalyzing: false
          };

          processedSnapshots.push(snapshot);
          if (!result.failed) collectionItemsForSynthesis.push({ taxonomy: result.taxonomy, ecologic: result.ecologic });
        }
      }

      let summaryText = "";
      if (collectionItemsForSynthesis.length > 1) {
        setProcessingStatus("Writing a few lines on the outing…");
        try {
          const collectionSynthesis = await GenAiService.synthesizeCollection(collectionItemsForSynthesis);
          summaryText = `${collectionSynthesis.title}: ${collectionSynthesis.description}`;
        } catch (e) {
          console.warn("Synthesis failed", e);
        }
      }

      setIsProcessing(false);
      RateLimitService.incrementUpload(userId, items.length);
      onProcessUploads(processedSnapshots, summaryText);
    } catch (err) {
      console.error("Upload processing failed", err);
      setUploadError("Your guide couldn't look at these just now. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 sm:p-6 animate-fade-in">
      <div
        className="absolute inset-0 bg-stone-900/80 backdrop-blur-md"
        onClick={isProcessing ? undefined : onClose}
        aria-hidden="true"
      />

      <section role="dialog" aria-modal="true" aria-labelledby="upload-title" className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">
        {/* Header */}
        <div className="p-6 sm:p-8 pb-4 border-b border-stone-100 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id="upload-title" className="text-2xl font-display text-stone-900 leading-tight">Bring in from your camera roll</h2>
            <p className="text-sm text-stone-500 mt-1 leading-snug">
              Photos, or sound and video clips up to 30 seconds. Up to 5 at a time.
            </p>
          </div>
          <button
            disabled={isProcessing}
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center hover:bg-stone-200 transition-colors disabled:opacity-50 shrink-0"
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-6 flex-1 no-scrollbar">
          {items.length < 5 && !isProcessing && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-stone-200 hover:border-theme-accent bg-stone-50/50 hover:bg-stone-900/[0.03] rounded-3xl text-center transition-all group"
            >
              <input
                ref={fileInputRef}
                id="upload-files"
                type="file"
                multiple
                accept="image/*,video/*,audio/*"
                className="sr-only"
                onChange={handleFileChange}
              />
              <label htmlFor="upload-files" className="block p-8 cursor-pointer">
                <span className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-stone-100 text-theme-accent flex items-center justify-center mx-auto mb-3" aria-hidden="true">
                  <span className="material-symbols-outlined text-3xl">photo_library</span>
                </span>
                <span className="block font-semibold text-stone-900 text-base mb-1">Choose photos, videos or sounds</span>
                <span className="block text-sm text-stone-500 leading-relaxed max-w-xs mx-auto">
                  Or drag them here. Your guide will name what it can.
                </span>
              </label>
            </div>
          )}

          {uploadError && (
            <div role="alert" className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-stone-800 text-sm flex items-start gap-3 animate-fade-in">
              <span className="material-symbols-outlined text-red-700 shrink-0 text-xl" aria-hidden="true">error</span>
              <p className="flex-1">{uploadError}</p>
              <button onClick={() => setUploadError(null)} aria-label="Dismiss" className="text-stone-500 hover:text-stone-800 -m-1 p-1">
                <span className="material-symbols-outlined text-base" aria-hidden="true">close</span>
              </button>
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-stone-700">Your files <span className="font-normal text-stone-500">({items.length} of 5)</span></span>
                {items.length > 1 && (
                  <label className="flex items-center gap-2 cursor-pointer text-stone-700">
                    <input
                      type="checkbox"
                      checked={shouldStitch}
                      onChange={(e) => setShouldStitch(e.target.checked)}
                      className="rounded accent-[rgb(var(--theme-accent-rgb))] w-4 h-4"
                    />
                    <span>Combine into one sighting</span>
                  </label>
                )}
              </div>

              <ul className="space-y-2 max-h-56 overflow-y-auto pr-1 no-scrollbar">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="p-3 bg-stone-50 border border-stone-100 rounded-2xl flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-stone-200 overflow-hidden relative shrink-0 flex items-center justify-center">
                        {item.type === 'image' && (
                          <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                        )}
                        {item.type === 'video' && (
                          <>
                            <video src={item.previewUrl} className="w-full h-full object-cover" muted playsInline />
                            <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow" aria-hidden="true"><span className="material-symbols-outlined text-xl">play_arrow</span></span>
                          </>
                        )}
                        {item.type === 'audio' && (
                          <Glyph name="sound" size={24} className="text-stone-600" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-800 truncate">{item.file.name}</p>
                        <p className="text-xs text-stone-500 truncate">
                          {takenLine(item) || (item.type === 'image' ? 'Photo' : item.type === 'video' ? 'Video' : 'Sound')}
                          {item.duration !== undefined && ` · ${item.duration} s`}
                        </p>
                      </div>
                    </div>

                    <button
                      disabled={isProcessing}
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.file.name}`}
                      className="w-9 h-9 rounded-full text-stone-500 hover:text-red-700 hover:bg-stone-100 flex items-center justify-center transition-colors shrink-0 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-base" aria-hidden="true">delete</span>
                    </button>
                  </li>
                ))}
              </ul>
              {items.some(i => i.coarse) && <p className="text-xs text-stone-500">Only the town is used. Exact GPS from your photos is never shared.</p>}
            </div>
          )}

          {isProcessing && (
            <div className="p-6 bg-stone-900/[0.03] border border-stone-200 rounded-3xl text-center space-y-3" role="status" aria-live="polite">
              <span className="text-theme-accent inline-flex motion-safe:animate-pulse" aria-hidden="true"><Glyph name="guide" size={32} /></span>
              <p className="text-sm text-stone-800">{processingStatus}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-stone-100 bg-stone-50/50 flex items-center justify-between gap-3 shrink-0">
          <button
            disabled={isProcessing}
            onClick={onClose}
            className="px-5 py-3 rounded-full text-sm font-semibold text-stone-600 hover:text-stone-900 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            disabled={items.length === 0 || isProcessing}
            onClick={handleProcess}
            className="flex-1 py-4 px-6 rounded-full bg-theme-accent text-white font-bold text-sm shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Glyph name="guide" size={18} />
            <span>{items.length > 1 ? `Show your guide (${items.length})` : 'Show your guide'}</span>
          </button>
        </div>
      </section>
    </div>
  );
};
export default UploadModal;
