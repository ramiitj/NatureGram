import React, { useState, useRef, useEffect } from 'react';
import { PressingLoader } from './SkeletonPost';
import { Snapshot } from '../types.ts';
import { GenAiService, tooLargeToAnalyse } from '../services/genAiService.ts';
import { RateLimitService, IDENTIFICATIONS_USED_MESSAGE } from '../services/rateLimitService.ts';
import { getMyAllowance } from '../services/firebaseService.ts';
import { useBackToClose } from '../services/overlayStack';
import { coarsenCoordinate, canCleanImage, UNCLEANABLE_IMAGE_MESSAGE } from '../utils';
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
  /** Larger than the guide can look at; it can still be added and named by the explorer */
  tooLarge?: boolean;
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

/** A sighting the explorer names themselves: nothing from the guide, and no error to explain. */
const selfNamedFields = (): Pick<Snapshot, "labels" | "behavior" | "aiInsight"> & Partial<Snapshot> => ({
  labels: [], behavior: '', aiInsight: '', aiError: null,
});
const TOO_LARGE_FOR_GUIDE = 'Too large for your guide to look at';

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
  /** Why the guide can't look today (allowance used); naming them yourself still works */
  const [guideBlocked, setGuideBlocked] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Closing while the guide is still looking drops its answer instead of opening review later
  const cancelledRef = useRef(false);

  const handleClose = () => { if (isProcessing) cancelledRef.current = true; setIsProcessing(false); onClose(); };
  const { close } = useBackToClose(isOpen, handleClose);

  // Say up front when today's identifications are used, before anything is chosen
  useEffect(() => {
    if (!isOpen) return;
    cancelledRef.current = false;
    let alive = true;
    getMyAllowance().then(a => {
      if (alive && a?.identifications && a.identifications.used >= a.identifications.limit) setGuideBlocked(IDENTIFICATIONS_USED_MESSAGE);
    }).catch(() => {});
    return () => { alive = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  const validateAndAddFiles = async (files: FileList | File[]) => {
    setUploadError(null);
    const fileList = Array.from(files);

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
        // A photo this browser can't redraw would keep its hidden location: it is never added
        if (!(await canCleanImage(file))) {
          URL.revokeObjectURL(previewUrl);
          setUploadError(`"${file.name}": ${UNCLEANABLE_IMAGE_MESSAGE}`);
          continue;
        }
        newItems.push({
          id: Math.random().toString(36).substr(2, 9),
          file,
          type: 'image',
          previewUrl
        });
      }
    }
    newItems.forEach(it => { it.tooLarge = tooLargeToAnalyse([it.file]); });

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

  /** useGuide: the guide looks at them (an AI identification); otherwise the explorer names them in review. */
  const handleProcess = async (useGuide: boolean) => {
    if (items.length === 0) return;
    if (useGuide && !RateLimitService.canUpload(userId, items.length)) {
      setGuideBlocked(IDENTIFICATIONS_USED_MESSAGE);
      return;
    }
    cancelledRef.current = false;

    setIsProcessing(true);
    setProcessingStatus(useGuide ? "Looking closely at your sightings…" : "Getting them ready…");

    try {
      const processedSnapshots: Snapshot[] = [];
      const collectionItemsForSynthesis: { taxonomy: string[]; ecologic: string }[] = [];

      // Check if we can perform a multimodal combined analysis if stitched
      if (shouldStitch && items.length > 1) {
        if (useGuide) setProcessingStatus("Your guide is looking at them together…");
        const imageItems = items.filter(i => i.type === 'image');
        const mediaItem = items.find(i => i.type === 'video' || i.type === 'audio');

        const imageBlobs = imageItems.map(i => i.file);
        const mediaBlob = mediaItem ? mediaItem.file : null;

        const tooLarge = tooLargeToAnalyse([mediaBlob, ...imageBlobs.slice(0, 4)]);
        const result: any = !useGuide ? { failed: true, selfNamed: true }
          : tooLarge ? { failed: true, message: TOO_LARGE_FOR_GUIDE }
          : await GenAiService.analyzeMultimodal(mediaBlob, imageBlobs, locationHint(items.find(i => i.coarse))).catch((e: any) => ({ failed: true, message: e?.message }));

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
          ...(result.selfNamed ? selfNamedFields() : governedFields(result)),
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
          if (useGuide) setProcessingStatus(items.length > 1 ? `Looking at ${i + 1} of ${items.length}…` : 'Looking closely…');

          // One file failing never blocks the others; the explorer names it in review
          const result: any = !useGuide ? { failed: true, selfNamed: true }
            : item.tooLarge ? { failed: true, message: TOO_LARGE_FOR_GUIDE }
            : await GenAiService.analyzeMedia(item.file, item.type, locationHint(item)).catch((e: any) => ({ failed: true, message: e?.message }));
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
            ...(result.selfNamed ? selfNamedFields() : governedFields(result)),
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

      if (cancelledRef.current) return;
      let summaryText = "";
      if (useGuide && collectionItemsForSynthesis.length > 1) {
        setProcessingStatus("Writing a few lines on the outing…");
        try {
          const collectionSynthesis = await GenAiService.synthesizeCollection(collectionItemsForSynthesis);
          summaryText = `${collectionSynthesis.title}: ${collectionSynthesis.description}`;
        } catch (e) {
          console.warn("Synthesis failed", e);
        }
      }

      if (cancelledRef.current) return;
      setIsProcessing(false);
      if (useGuide) RateLimitService.incrementUpload(userId, items.length);
      onProcessUploads(processedSnapshots, summaryText);
    } catch (err) {
      console.error("Upload processing failed", err);
      if (cancelledRef.current) return;
      setUploadError(useGuide ? "Your guide couldn't look at these just now. Try again, or name them yourself." : "These couldn't be added just now. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 sm:p-6 animate-fade-in">
      <div
        className="absolute inset-0 ng-scrim"
        onClick={isProcessing ? undefined : close}
        aria-hidden="true"
      />

      <section role="dialog" aria-modal="true" aria-labelledby="upload-title" className="relative w-full max-w-lg bg-day-bg rounded-2xl shadow-[0_24px_60px_-24px_rgba(28,25,23,0.5)] overflow-hidden flex flex-col max-h-[90vh] ng-rise">
        {/* Header */}
        <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-2 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id="upload-title" className="ng-title">Bring in from your camera roll</h2>
            <p className="ng-small mt-2">
              Photos, or sound and video clips up to 30 seconds. Up to 5 at a time.
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="ng-icon-button -mr-2 -mt-1 text-stone-500"
          >
            <Glyph name="close" size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 sm:px-8 py-6 overflow-y-auto space-y-6 flex-1 no-scrollbar">
          {items.length < 5 && !isProcessing && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="border border-dashed border-stone-300 hover:border-stone-500 rounded-xl text-center transition-colors group"
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
                <span className="flex items-center justify-center mx-auto mb-4 text-stone-500" aria-hidden="true">
                  <Glyph name="gallery" size={32} strokeWidth={1.3} />
                </span>
                <span className="block font-display italic text-[20px] text-stone-900 mb-1">Choose photos, videos or sounds</span>
                <span className="block ng-small max-w-xs mx-auto">
                  Or drag them here. Your guide, an AI, names what it can, or you can name them yourself.
                </span>
              </label>
            </div>
          )}

          {uploadError && (
            <div role="alert" className="pl-4 py-1 border-l-2 border-red-700 text-stone-800 text-sm flex items-start gap-3 animate-fade-in">
              <Glyph name="alert" size={20} className="text-red-700 shrink-0" />
              <p className="flex-1">{uploadError}</p>
              <button onClick={() => setUploadError(null)} aria-label="Dismiss" className="text-stone-500 hover:text-stone-800 -m-1 p-1">
                <Glyph name="close" size={20} />
              </button>
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="ng-label">Your files <span className="font-normal text-stone-500">({items.length} of 5)</span></span>
                {items.length > 1 && (
                  <label className="flex items-center gap-2 cursor-pointer text-stone-700">
                    <input
                      type="checkbox"
                      checked={shouldStitch}
                      onChange={(e) => setShouldStitch(e.target.checked)}
                      className="rounded accent-stone-900 w-4 h-4"
                    />
                    <span>Combine into one sighting</span>
                  </label>
                )}
              </div>

              <ul className="max-h-56 overflow-y-auto pr-1 no-scrollbar border-t border-stone-200/80">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="py-3 border-b border-stone-200/80 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-md bg-[#f3efe7] overflow-hidden relative shrink-0 flex items-center justify-center">
                        {item.type === 'image' && (
                          <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                        )}
                        {item.type === 'video' && (
                          <>
                            <video src={item.previewUrl} className="w-full h-full object-cover" muted playsInline />
                            <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow" aria-hidden="true"><Glyph name="play" size={20} /></span>
                          </>
                        )}
                        {item.type === 'audio' && (
                          <Glyph name="sound" size={24} className="text-stone-600" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-800 truncate">{item.file.name}</p>
                        <p className="ng-caption truncate">
                          {takenLine(item) || (item.type === 'image' ? 'Photo' : item.type === 'video' ? 'Video' : 'Sound')}
                          {item.duration !== undefined && ` · ${item.duration} s`}
                        </p>
                        {item.tooLarge && <p className="ng-caption text-amber-900">Too large for your guide to look at. You can name it yourself.</p>}
                      </div>
                    </div>

                    <button
                      disabled={isProcessing}
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.file.name}`}
                      className="ng-icon-button text-stone-500 hover:text-red-700"
                    >
                      <Glyph name="trash" size={20} />
                    </button>
                  </li>
                ))}
              </ul>
              {items.some(i => i.coarse) && <p className="ng-caption">Only the town is used. Exact GPS from your photos is never shared.</p>}
            </div>
          )}

          {isProcessing && (
            <div className="py-6 text-center space-y-3" role="status" aria-live="polite">
              <PressingLoader size={32} />
              <p className="font-display italic text-base text-stone-700">{processingStatus}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-8 py-5 border-t border-stone-200/80 shrink-0 space-y-3">
          {guideBlocked && <p className="ng-small text-stone-700" role="status">{guideBlocked}</p>}
          {!guideBlocked && items.length > 0 && items.every(i => i.tooLarge) && (
            <p className="ng-small text-stone-700" role="status">{items.length === 1 ? 'This file is' : 'These files are'} too large for your guide to look at. You can still add them and name them yourself.</p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
            <button
              onClick={close}
              className="ng-link-quiet min-h-[44px] sm:mr-auto"
            >
              Cancel
            </button>
            <button
              disabled={items.length === 0 || isProcessing}
              onClick={() => handleProcess(false)}
              className="ng-button-quiet"
            >
              Name it myself
            </button>
            <button
              disabled={items.length === 0 || isProcessing || !!guideBlocked || items.every(i => i.tooLarge)}
              onClick={() => handleProcess(true)}
              className="ng-button-primary"
            >
              <Glyph name="guide" size={20} className="ng-arrow" />
              <span>{items.length > 1 ? `Show your guide (${items.length})` : 'Show your guide'}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
export default UploadModal;
