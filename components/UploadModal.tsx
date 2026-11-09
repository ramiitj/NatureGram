import React, { useState, useRef } from 'react';
import { Snapshot } from '../types.ts';
import { GenAiService } from '../services/genAiService.ts';
import { RateLimitService } from '../services/rateLimitService.ts';

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
}

export const UploadModal: React.FC<UploadModalProps> = ({
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
        setUploadError("You have reached your daily upload limit (max 3 batches or 15 files/day).");
        return;
    }

    if (items.length + fileList.length > 5) {
      setUploadError("Maximum 5 files allowed per upload batch.");
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
        setUploadError(`Unsupported file format: ${file.name}. Only images, videos, and audio are supported.`);
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
            setUploadError(`"${file.name}" exceeds 30s limit (${Math.round(duration)}s). Please choose audio/video under 30 seconds.`);
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
    setProcessingStatus("Analyzing observations with NatureGram AI...");

    try {
      const processedSnapshots: Snapshot[] = [];
      const collectionItemsForSynthesis: { taxonomy: string[]; ecologic: string }[] = [];

      // Check if we can perform a multimodal combined analysis if stitched
      if (shouldStitch && items.length > 1) {
        setProcessingStatus("Performing multimodal stitched observation analysis...");
        const imageItems = items.filter(i => i.type === 'image');
        const mediaItem = items.find(i => i.type === 'video' || i.type === 'audio');

        const imageBlobs = imageItems.map(i => i.file);
        const mediaBlob = mediaItem ? mediaItem.file : null;

        const result = await GenAiService.analyzeMultimodal(
          mediaBlob,
          imageBlobs,
          "Uploaded Field Station"
        );

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
          labels: result.taxonomy,
          behavior: result.ecologic.slice(0, 120) + "...",
          aiInsight: result.ecologic,
          type: primaryItem.type,
          userId,
          isHybrid: items.length > 1,
          associatedImages: imageItems.map(img => ({ url: img.previewUrl, blob: img.file })),
          location: result.location || "Uploaded Observation",
          isAnalyzing: false
        };

        processedSnapshots.push(stitchedSnapshot);
        collectionItemsForSynthesis.push({ taxonomy: result.taxonomy, ecologic: result.ecologic });
      } else {
        // Individual analysis per uploaded file
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          setProcessingStatus(`Analyzing item ${i + 1} of ${items.length}...`);

          const result = await GenAiService.analyzeMedia(item.file, item.type, "Uploaded Field Station");
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
            labels: result.taxonomy,
            behavior: result.ecologic.slice(0, 120) + "...",
            aiInsight: result.ecologic,
            type: item.type,
            userId,
            isHybrid: false,
            location: result.location || "Uploaded Observation",
            isAnalyzing: false
          };

          processedSnapshots.push(snapshot);
          collectionItemsForSynthesis.push({ taxonomy: result.taxonomy, ecologic: result.ecologic });
        }
      }

      let summaryText = "Uploaded Field Observations.";
      if (processedSnapshots.length > 0) {
        setProcessingStatus("Synthesizing expedition notes...");
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
      setUploadError("Failed to analyze uploaded media. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 sm:p-6 animate-fade-in">
      <div
        className="absolute inset-0 bg-stone-900/80 backdrop-blur-md"
        onClick={isProcessing ? undefined : onClose}
      />

      <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">
        {/* Header */}
        <div className="p-6 sm:p-8 pb-4 border-b border-stone-100 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-theme-accent text-xl shrink-0">upload_file</span>
              <h2 className="text-2xl font-display font-black italic text-stone-900 truncate">Direct Media Upload</h2>
            </div>
            <p className="text-[11px] text-stone-500 font-bold uppercase tracking-wider leading-snug">
              Photos, Audio & Video <span className="text-stone-300">•</span> Max 30s <span className="text-stone-300">•</span> Up to 5 files
            </p>
          </div>
          <button
            disabled={isProcessing}
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center hover:bg-stone-200 transition-colors disabled:opacity-50 shrink-0"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-6 flex-1 no-scrollbar">
          {/* Dropzone */}
          {items.length < 5 && !isProcessing && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-stone-200 hover:border-theme-accent bg-stone-50/50 hover:bg-theme-accent/5 rounded-3xl p-8 text-center cursor-pointer transition-all group"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-stone-100 text-theme-accent flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-3xl">cloud_upload</span>
              </div>
              <h3 className="font-bold text-stone-900 text-base mb-1">Tap or Drag Files Here</h3>
              <p className="text-xs text-stone-500 leading-relaxed max-w-xs mx-auto">
                Upload photos, audio field recordings, or video observations (max 30s each).
              </p>
              <div className="inline-flex flex-wrap items-center justify-center gap-2 sm:gap-3 mt-4 px-4 py-2 rounded-full bg-stone-100 text-[10px] font-bold uppercase tracking-wider text-stone-600 max-w-full">
                <span>Photos</span>
                <span className="text-stone-300">•</span>
                <span>Audio (&le;30s)</span>
                <span className="text-stone-300">•</span>
                <span>Video (&le;30s)</span>
              </div>
            </div>
          )}

          {/* Upload Error Banner */}
          {uploadError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-3 animate-fade-in">
              <span className="material-symbols-outlined text-rose-500 shrink-0">error</span>
              <p className="flex-1 font-medium">{uploadError}</p>
              <button onClick={() => setUploadError(null)} className="text-rose-400 hover:text-rose-600">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          {/* Items List */}
          {items.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-stone-400 uppercase tracking-wider">
                <span>Selected Media ({items.length}/5)</span>
                {items.length > 1 && (
                  <label className="flex items-center gap-2 cursor-pointer text-theme-accent normal-case">
                    <input
                      type="checkbox"
                      checked={shouldStitch}
                      onChange={(e) => setShouldStitch(e.target.checked)}
                      className="rounded accent-theme-accent w-4 h-4"
                    />
                    <span>Stitch into unified entry</span>
                  </label>
                )}
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1 no-scrollbar">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-stone-50 border border-stone-100 rounded-2xl flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-stone-200 overflow-hidden relative shrink-0 flex items-center justify-center">
                        {item.type === 'image' && (
                          <img src={item.previewUrl} alt="preview" className="w-full h-full object-cover" />
                        )}
                        {item.type === 'video' && (
                          <video src={item.previewUrl} className="w-full h-full object-cover" />
                        )}
                        {item.type === 'audio' && (
                          <span className="material-symbols-outlined text-stone-600 text-2xl">graphic_eq</span>
                        )}
                        <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[8px] font-bold px-1 rounded uppercase">
                          {item.type}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <p className="text-xs font-bold text-stone-800 truncate">{item.file.name}</p>
                        <p className="text-[10px] text-stone-400">
                          {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                          {item.duration !== undefined && ` • ${item.duration}s`}
                        </p>
                      </div>
                    </div>

                    <button
                      disabled={isProcessing}
                      onClick={() => removeItem(item.id)}
                      className="w-8 h-8 rounded-full bg-stone-100 text-stone-400 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center transition-colors shrink-0 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Processing Status */}
          {isProcessing && (
            <div className="p-6 bg-theme-accent/5 border border-theme-accent/20 rounded-3xl text-center space-y-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-theme-accent text-white flex items-center justify-center mx-auto animate-spin">
                <span className="material-symbols-outlined">sync</span>
              </div>
              <p className="text-xs font-bold text-stone-800 uppercase tracking-wider">{processingStatus}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-stone-100 bg-stone-50/50 flex items-center justify-between gap-3 shrink-0">
          <button
            disabled={isProcessing}
            onClick={onClose}
            className="px-6 py-3 rounded-full text-xs font-bold uppercase tracking-wider text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            disabled={items.length === 0 || isProcessing}
            onClick={handleProcess}
            className="flex-1 py-4 px-6 rounded-full bg-theme-accent text-white font-bold text-sm tracking-wide shadow-lg shadow-theme-shadow hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined text-lg">psychology</span>
            <span>Process Observations ({items.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
export default UploadModal;
