import React, { useState, useRef, useEffect } from 'react';
import { rotateImageBlob, applyFilter, applyImageAdjustments, cropImageBlob } from '../services/imageUtils';
import { trimAudioBlob, trimVideoBlob } from '../services/mediaTrimUtils';

interface MediaEditorProps {
  type: 'image' | 'video' | 'audio';
  source: string;
  initialRotation?: number;
  onSave: (result: { blob?: Blob, rotation?: number }) => void;
  onCancel: () => void;
}

type CropRect = { x: number, y: number, width: number, height: number };
const DEFAULT_CROP: CropRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const MediaEditor: React.FC<MediaEditorProps> = ({ type, source, initialRotation = 0, onSave, onCancel }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [rotation, setRotation] = useState(initialRotation);
  const [filter, setFilter] = useState<'none' | 'grayscale'>('none');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect>(DEFAULT_CROP);
  const [hasCrop, setHasCrop] = useState(false);
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ mode: DragMode, startX: number, startY: number, startRect: CropRect } | null>(null);

  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handlePointerDown = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragStateRef.current = { mode, startX: e.clientX, startY: e.clientY, startRect: cropRect };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || !imageWrapperRef.current) return;
    const rect = imageWrapperRef.current.getBoundingClientRect();
    const dxFrac = (e.clientX - drag.startX) / rect.width;
    const dyFrac = (e.clientY - drag.startY) / rect.height;
    let { x, y, width, height } = drag.startRect;
    const MIN = 0.08;

    if (drag.mode === 'move') {
      x = clamp(x + dxFrac, 0, 1 - width);
      y = clamp(y + dyFrac, 0, 1 - height);
    } else {
      if (drag.mode.includes('w')) {
        const newX = clamp(x + dxFrac, 0, x + width - MIN);
        width = width + (x - newX);
        x = newX;
      }
      if (drag.mode.includes('e')) {
        width = clamp(width + dxFrac, MIN, 1 - x);
      }
      if (drag.mode.includes('n')) {
        const newY = clamp(y + dyFrac, 0, y + height - MIN);
        height = height + (y - newY);
        y = newY;
      }
      if (drag.mode.includes('s')) {
        height = clamp(height + dyFrac, MIN, 1 - y);
      }
    }
    setCropRect({ x, y, width, height });
    setHasCrop(true);
  };

  const handlePointerUp = () => { dragStateRef.current = null; };

  const handleLoadedMetadata = () => {
    const el = mediaRef.current;
    if (!el) return;
    setDuration(el.duration);
    setTrimEnd(el.duration);
  };

  // Keep the trim-end handle within the browser's actual clip length —
  // metadata duration can arrive slightly off for some containers.
  useEffect(() => {
    if (duration > 0 && trimEnd > duration) setTrimEnd(duration);
  }, [duration]);

  const isTrimmed = duration > 0 && (trimStart > 0.05 || trimEnd < duration - 0.05);

  const handleSave = async () => {
    setIsProcessing(true);
    try {
      if (type === 'image') {
        let blob: Blob | string = source;

        if (hasCrop) {
          blob = await cropImageBlob(blob, cropRect);
        }

        blob = await applyImageAdjustments(blob, { brightness, contrast, flipH, flipV });

        if (filter !== 'none') {
          blob = await applyFilter(blob, filter);
        }

        if (rotation !== initialRotation) {
          blob = await rotateImageBlob(blob, rotation);
        }

        onSave({ blob: blob as Blob, rotation: 0 });
      } else if (type === 'audio') {
        if (isTrimmed) {
          const response = await fetch(source);
          const blob = await trimAudioBlob(await response.blob(), trimStart, trimEnd);
          onSave({ blob });
        } else {
          onCancel();
        }
      } else if (type === 'video') {
        if (isTrimmed) {
          const response = await fetch(source);
          const blob = await trimVideoBlob(await response.blob(), trimStart, trimEnd);
          onSave({ blob });
        } else {
          onCancel();
        }
      }
    } catch (e) {
      console.error("Failed to process media", e);
      alert("Failed to process media");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col text-white">
      <div className="flex justify-between items-center p-4 border-b border-white/10">
        <button onClick={onCancel} className="text-sm font-medium text-white/70 hover:text-white transition-colors">Cancel</button>
        <span className="text-sm font-bold tracking-widest uppercase">Edit Media</span>
        <button
          onClick={handleSave}
          disabled={isProcessing}
          className="text-sm font-medium text-theme-accent disabled:opacity-50 hover:text-theme-accent/80 transition-colors"
        >
          {isProcessing ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
        {type === 'image' && (
          <div
            ref={imageWrapperRef}
            className="relative inline-block touch-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <img
              src={source}
              alt="Editor"
              className="block shadow-2xl rounded-lg transition-transform duration-300"
              style={{
                  maxWidth: '80vw',
                  maxHeight: '60vh',
                  transform: isCropping ? undefined : `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
                  filter: isCropping ? undefined : `brightness(${brightness}%) contrast(${contrast}%) ${filter === 'grayscale' ? 'grayscale(100%)' : ''}`
              }}
            />
            {isCropping && (
              <div
                className="absolute border-2 border-theme-accent bg-theme-accent/10 cursor-move"
                style={{
                    left: `${cropRect.x * 100}%`,
                    top: `${cropRect.y * 100}%`,
                    width: `${cropRect.width * 100}%`,
                    height: `${cropRect.height * 100}%`,
                }}
                onPointerDown={handlePointerDown('move')}
              >
                {(['nw', 'ne', 'sw', 'se'] as DragMode[]).map(corner => (
                  <div
                    key={corner}
                    onPointerDown={handlePointerDown(corner)}
                    className={`absolute w-5 h-5 bg-white border-2 border-theme-accent rounded-full touch-none ${
                        corner === 'nw' ? '-left-2.5 -top-2.5 cursor-nwse-resize' :
                        corner === 'ne' ? '-right-2.5 -top-2.5 cursor-nesw-resize' :
                        corner === 'sw' ? '-left-2.5 -bottom-2.5 cursor-nesw-resize' :
                        '-right-2.5 -bottom-2.5 cursor-nwse-resize'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {type === 'video' && (
          <video ref={mediaRef} src={source} controls onLoadedMetadata={handleLoadedMetadata} className="max-w-full max-h-full rounded-lg shadow-2xl" />
        )}
        {type === 'audio' && (
          <div className="bg-white/5 p-8 rounded-2xl w-full max-w-md border border-white/10 flex flex-col items-center gap-4">
            <div className="text-center mb-6">
              <span className="material-symbols-outlined text-4xl text-theme-accent mb-2">graphic_eq</span>
              <h3 className="font-semibold">Audio Recording</h3>
            </div>
            <audio ref={mediaRef} src={source} controls onLoadedMetadata={handleLoadedMetadata} className="w-full" />
          </div>
        )}
      </div>

      <div className="p-6 flex flex-col gap-4 border-t border-white/10">
        {type === 'image' && (
            <>
                <div className="flex justify-center gap-4">
                    <button onClick={handleRotate} disabled={isCropping} className="p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"><span className="material-symbols-outlined">rotate_right</span></button>
                    <button onClick={() => setFlipH(!flipH)} disabled={isCropping} className="p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"><span className="material-symbols-outlined">flip</span></button>
                    <button onClick={() => setFilter(filter === 'grayscale' ? 'none' : 'grayscale')} disabled={isCropping} className={`p-3 rounded-full disabled:opacity-30 ${filter === 'grayscale' ? 'bg-theme-accent' : 'bg-white/10'}`}>BW</button>
                    <button
                        onClick={() => setIsCropping(prev => !prev)}
                        className={`p-3 rounded-full flex items-center gap-1.5 px-4 ${isCropping ? 'bg-theme-accent' : 'bg-white/10 hover:bg-white/20'}`}
                    >
                        <span className="material-symbols-outlined">crop</span>
                        <span className="text-xs font-bold uppercase tracking-widest">{isCropping ? 'Done' : 'Crop'}</span>
                    </button>
                </div>
                {isCropping ? (
                    <p className="text-center text-xs text-white/50">Drag the corners to resize, or drag inside to move.</p>
                ) : (
                    <div className="flex gap-4 text-xs">
                        <label>Brightness: <input type="range" min="50" max="150" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} /></label>
                        <label>Contrast: <input type="range" min="50" max="150" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} /></label>
                    </div>
                )}
            </>
        )}
        {(type === 'video' || type === 'audio') && duration > 0 && (
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs text-white/70">
                    <span>Trim: {formatTime(trimStart)}</span>
                    <span>{formatTime(trimEnd)}</span>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40">Start</label>
                    <input
                        type="range"
                        min={0}
                        max={duration}
                        step={0.1}
                        value={trimStart}
                        onChange={(e) => {
                            const v = Math.min(Number(e.target.value), trimEnd - 0.5);
                            setTrimStart(Math.max(0, v));
                            if (mediaRef.current) mediaRef.current.currentTime = v;
                        }}
                    />
                    <label className="text-[10px] uppercase tracking-widest text-white/40">End</label>
                    <input
                        type="range"
                        min={0}
                        max={duration}
                        step={0.1}
                        value={trimEnd}
                        onChange={(e) => {
                            const v = Math.max(Number(e.target.value), trimStart + 0.5);
                            setTrimEnd(Math.min(duration, v));
                            if (mediaRef.current) mediaRef.current.currentTime = v;
                        }}
                    />
                </div>
                <p className="text-center text-xs text-white/50">
                    {isTrimmed ? `Will save as a ${formatTime(trimEnd - trimStart)} clip.` : 'Move the handles to trim this clip.'}
                </p>
            </div>
        )}
      </div>
    </div>
  );
};

export default MediaEditor;
