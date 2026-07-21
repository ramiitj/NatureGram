import React, { useState } from 'react';
import { rotateImageBlob, applyFilter, applyImageAdjustments } from '../services/imageUtils';

interface MediaEditorProps {
  type: 'image' | 'video' | 'audio';
  source: string;
  initialRotation?: number;
  onSave: (result: { blob?: Blob, rotation?: number }) => void;
  onCancel: () => void;
}

const MediaEditor: React.FC<MediaEditorProps> = ({ type, source, initialRotation = 0, onSave, onCancel }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [rotation, setRotation] = useState(initialRotation);
  const [filter, setFilter] = useState<'none' | 'grayscale'>('none');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleSave = async () => {
    setIsProcessing(true);
    try {
      if (type === 'image') {
        let blob: Blob | string = source;
        
        // Apply adjustments
        blob = await applyImageAdjustments(blob, { brightness, contrast, flipH, flipV });
        
        // Apply filter
        if (filter !== 'none') {
            blob = await applyFilter(blob, filter);
        }
        
        // Apply rotation
        if (rotation !== initialRotation) {
            blob = await rotateImageBlob(blob, rotation);
        }
        
        onSave({ blob: blob as Blob, rotation: 0 });
      } else {
        // For video/audio, we just close (volume is handled by HTML5 controls)
        onCancel();
      }
    } catch (e) {
      console.error("Failed to process media", e);
      alert("Failed to process media");
    } finally {
      setIsProcessing(false);
    }
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
          <img 
            src={source} 
            alt="Editor" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-transform duration-300" 
            style={{ 
                transform: `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
                filter: `brightness(${brightness}%) contrast(${contrast}%) ${filter === 'grayscale' ? 'grayscale(100%)' : ''}`
            }} 
          />
        )}
        {type === 'video' && (
          <video src={source} controls className="max-w-full max-h-full rounded-lg shadow-2xl" />
        )}
        {type === 'audio' && (
          <div className="bg-white/5 p-8 rounded-2xl w-full max-w-md border border-white/10 flex flex-col items-center gap-4">
            <div className="text-center mb-6">
              <span className="material-symbols-outlined text-4xl text-theme-accent mb-2">graphic_eq</span>
              <h3 className="font-semibold">Audio Recording</h3>
            </div>
            <audio src={source} controls className="w-full" />
          </div>
        )}
      </div>
      
      <div className="p-6 flex flex-col gap-4 border-t border-white/10">
        {type === 'image' && (
            <>
                <div className="flex justify-center gap-4">
                    <button onClick={handleRotate} className="p-3 rounded-full bg-white/10 hover:bg-white/20"><span className="material-symbols-outlined">rotate_right</span></button>
                    <button onClick={() => setFlipH(!flipH)} className="p-3 rounded-full bg-white/10 hover:bg-white/20"><span className="material-symbols-outlined">flip</span></button>
                    <button onClick={() => setFilter(filter === 'grayscale' ? 'none' : 'grayscale')} className={`p-3 rounded-full ${filter === 'grayscale' ? 'bg-theme-accent' : 'bg-white/10'}`}>BW</button>
                </div>
                <div className="flex gap-4 text-xs">
                    <label>Brightness: <input type="range" min="50" max="150" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} /></label>
                    <label>Contrast: <input type="range" min="50" max="150" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} /></label>
                </div>
            </>
        )}
        {(type === 'video' || type === 'audio') && (
            <div className="text-center text-xs text-white/50">
                Volume and playback controls are available in the media player above.
            </div>
        )}
      </div>
    </div>
  );
};

export default MediaEditor;
