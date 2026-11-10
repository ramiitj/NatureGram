import React, { useEffect, useRef, useState } from 'react';
import { rotateImageBlob } from '../services/imageUtils';
import Glyph from './Glyph';

interface MediaEditorProps {
  type: 'image' | 'video' | 'audio';
  source: string;
  initialRotation?: number;
  onSave: (result: { blob?: Blob, rotation?: number }) => void;
  onCancel: () => void;
}

/** How the specimen sits in its frame: the original shape, or one of the shapes a plate or feed uses. */
const FRAMES: { id: string; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'As taken', ratio: null },
  { id: 'square', label: 'Square', ratio: 1 },
  { id: 'portrait', label: 'Portrait', ratio: 4 / 5 },
  { id: 'wide', label: 'Wide', ratio: 3 / 2 },
];

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

/**
 * "Frame the specimen": turn it upright and crop close, the two things a field photograph needs.
 * Colour adjustments were dropped on purpose; a record should look the way the subject looked.
 */
const MediaEditor: React.FC<MediaEditorProps> = ({ type, source, initialRotation = 0, onSave, onCancel }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [rotation, setRotation] = useState(initialRotation);
  const [frame, setFrame] = useState(FRAMES[0]);
  const [zoom, setZoom] = useState(1);
  // Where the crop sits inside the free space, from -0.5 (left/top) to 0.5 (right/bottom)
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // The upright image the crop is taken from: the source, or a rotated copy of it
  const [work, setWork] = useState<{ url: string; blob?: Blob; w: number; h: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const turns = rotation !== initialRotation ? rotation : 0;

  useEffect(() => {
    if (type !== 'image') return;
    let alive = true; let made: string | null = null;
    (async () => {
      try {
        if (turns % 360 === 0) {
          const img = await loadImage(source);
          if (alive) setWork({ url: source, w: img.naturalWidth, h: img.naturalHeight });
        } else {
          const blob = await rotateImageBlob(source, turns);
          made = URL.createObjectURL(blob);
          const img = await loadImage(made);
          if (alive) setWork({ url: made, blob, w: img.naturalWidth, h: img.naturalHeight });
        }
      } catch {
        if (alive) setError("Couldn't load this photo for framing.");
      }
    })();
    return () => { alive = false; if (made) setTimeout(() => URL.revokeObjectURL(made!), 1000); };
  }, [type, source, turns]);

  // Crop rectangle in image pixels for the current frame, zoom and position
  const crop = (() => {
    if (!work) return null;
    const ratio = frame.ratio ?? work.w / work.h;
    const baseW = Math.min(work.w, work.h * ratio);
    const cw = baseW / zoom, ch = baseW / ratio / zoom;
    const x = (work.w - cw) * (pos.x + 0.5), y = (work.h - ch) * (pos.y + 0.5);
    return { x, y, w: cw, h: ch, ratio };
  })();
  const isCropped = !!crop && !!work && (frame.ratio !== null || zoom > 1.001);

  const nudge = (dx: number, dy: number) => setPos(p => ({ x: Math.max(-0.5, Math.min(0.5, p.x + dx)), y: Math.max(-0.5, Math.min(0.5, p.y + dy)) }));

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !crop || !work || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const scale = rect.width / crop.w; // screen px per image px
    const freeX = (work.w - crop.w) * scale, freeY = (work.h - crop.h) * scale;
    const dx = e.clientX - dragRef.current.x, dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    nudge(freeX > 0 ? -dx / freeX : 0, freeY > 0 ? -dy / freeY : 0);
  };

  const handleSave = async () => {
    setIsProcessing(true);
    setError('');
    try {
      if (type === 'image') {
        if (!isCropped) {
          if (rotation === initialRotation) { onCancel(); return; }
          const blob = work?.blob || await rotateImageBlob(source, rotation);
          onSave({ blob, rotation: 0 });
          return;
        }
        // Crop from an upright, same-origin copy so the canvas can be read back
        const blob = work?.blob || await rotateImageBlob(source, 0);
        const url = URL.createObjectURL(blob);
        try {
          const img = await loadImage(url);
          const sx = img.naturalWidth / work!.w, sy = img.naturalHeight / work!.h;
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(crop!.w * sx)); c.height = Math.max(1, Math.round(crop!.h * sy));
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('No canvas');
          ctx.drawImage(img, crop!.x * sx, crop!.y * sy, crop!.w * sx, crop!.h * sy, 0, 0, c.width, c.height);
          const out = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.92));
          if (!out) throw new Error('No blob');
          onSave({ blob: out, rotation: 0 });
        } finally { URL.revokeObjectURL(url); }
      } else if (type === 'video' && rotation !== initialRotation) {
        // Videos keep their file; the rotation is stored and applied on playback
        onSave({ rotation });
      } else {
        onCancel();
      }
    } catch (e) {
      console.error("Failed to process media", e);
      setError("Couldn't save the framing. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const bgStyle: React.CSSProperties | undefined = work && crop ? {
    backgroundImage: `url("${work.url}")`,
    backgroundSize: `${(work.w / crop.w) * 100}% auto`,
    backgroundPosition: `${(pos.x + 0.5) * 100}% ${(pos.y + 0.5) * 100}%`,
    backgroundRepeat: 'no-repeat',
    aspectRatio: String(crop.ratio),
  } : undefined;

  return (
    <div className="fixed inset-0 z-[200] bg-stone-950/95 flex flex-col text-white" role="dialog" aria-modal="true" aria-labelledby="frame-title">
      <div className="flex justify-between items-center p-4 border-b border-white/10 safe-pt">
        <button onClick={onCancel} className="text-sm font-medium text-white/75 hover:text-white transition-colors px-2 py-2">Cancel</button>
        <h2 id="frame-title" className="text-base font-display">{type === 'image' ? 'Frame your sighting' : type === 'video' ? 'Turn the clip upright' : 'Your sound'}</h2>
        <button
          onClick={handleSave}
          disabled={isProcessing || (type === 'image' && !work)}
          className="text-sm font-semibold text-theme-vivid disabled:opacity-50 hover:opacity-80 transition-opacity px-2 py-2"
        >
          {isProcessing ? 'Saving…' : 'Done'}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden relative">
        {type === 'image' && (
          work && bgStyle ? (
            <div
              ref={frameRef}
              tabIndex={0}
              role="img"
              aria-label="Crop preview. Drag, or use the arrow keys, to move the frame."
              onPointerDown={(e) => { dragRef.current = { x: e.clientX, y: e.clientY }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
              onPointerMove={onPointerMove}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
              onKeyDown={(e) => {
                const k: Record<string, [number, number]> = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] };
                if (k[e.key]) { e.preventDefault(); nudge(...k[e.key]); }
              }}
              className="relative touch-none cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-white/70 shadow-2xl"
              style={{ ...bgStyle, width: `min(88vw, ${(55 * crop!.ratio).toFixed(2)}vh)` }}
            >
              {/* A thirds grid, like the lines on a field sketching frame */}
              <div className="absolute inset-0 pointer-events-none border border-white/60" aria-hidden="true">
                <div className="absolute inset-y-0 left-1/3 border-l border-white/25" /><div className="absolute inset-y-0 left-2/3 border-l border-white/25" />
                <div className="absolute inset-x-0 top-1/3 border-t border-white/25" /><div className="absolute inset-x-0 top-2/3 border-t border-white/25" />
              </div>
            </div>
          ) : !error && <span className="text-white/60 inline-flex motion-safe:animate-pulse" aria-hidden="true"><Glyph name="lens" size={36} /></span>
        )}
        {type === 'video' && (
          <video src={source} controls className="max-w-full max-h-full rounded-lg shadow-2xl transition-transform duration-300" style={{ transform: `rotate(${rotation}deg)` }} />
        )}
        {type === 'audio' && (
          <div className="bg-white/5 p-8 rounded-2xl w-full max-w-md border border-white/10 flex flex-col items-center gap-4">
            <Glyph name="sound" size={40} className="text-theme-vivid" />
            <audio src={source} controls className="w-full" />
          </div>
        )}
      </div>

      <div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col gap-4 border-t border-white/10">
        {error && <p role="alert" className="text-sm text-center text-red-200">{error}</p>}
        {type === 'image' && (
          <>
            <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Frame shape">
              {FRAMES.map(f => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={frame.id === f.id}
                  onClick={() => { setFrame(f); setPos({ x: 0, y: 0 }); }}
                  className={`px-4 py-2 rounded-full text-sm transition-colors ${frame.id === f.id ? 'bg-white text-stone-900 font-semibold' : 'bg-white/10 text-white/85 hover:bg-white/15'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-center gap-4 max-w-sm mx-auto w-full">
              <button onClick={() => setRotation(prev => (prev + 90) % 360)} aria-label="Turn a quarter" className="w-11 h-11 shrink-0 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <span className="material-symbols-outlined" aria-hidden="true">rotate_right</span>
              </button>
              <label className="flex-1 flex items-center gap-3 text-sm text-white/80">
                <span className="shrink-0">Closer</span>
                <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[rgb(var(--theme-accent-rgb))]" />
              </label>
            </div>
          </>
        )}
        {type === 'video' && (
          <div className="flex justify-center">
            <button onClick={() => setRotation(prev => (prev + 90) % 360)} className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-xl" aria-hidden="true">rotate_right</span>Turn a quarter
            </button>
          </div>
        )}
        {type === 'audio' && (
          <p className="text-center text-sm text-white/60">Volume and playback are in the player above.</p>
        )}
      </div>
    </div>
  );
};

export default MediaEditor;
