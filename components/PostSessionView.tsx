
import React, { useState, useEffect, useRef } from 'react';
import { Snapshot, UserMode } from '../types.ts';
import { FirebaseService } from '../services/firebaseService.ts';
import { generateFieldCard } from '../services/audioUtils.ts';
import { rotateImageBlob } from '../services/imageUtils.ts';
import { GenAiService } from '../services/genAiService.ts';
import { GeminiLiveService } from '../services/geminiLiveService.ts';
import AuthModal from './AuthModal.tsx';
import { motion } from 'motion/react';

interface PostSessionViewProps {
  snapshots: Snapshot[];
  summary: string;
  userMode: UserMode;
  onClose: () => void;
  onViewFeed: () => void;
  onSaveDraft: () => void;
  geminiServiceRef: React.MutableRefObject<GeminiLiveService | null>;
  updateSnapshot: (id: string, updates: Partial<Snapshot>) => void;
  pendingSnapshotIdRef: React.MutableRefObject<string | null>;
}

const PostSessionView: React.FC<PostSessionViewProps> = ({ snapshots: initialSnapshots, summary, userMode, onClose, onViewFeed, onSaveDraft, geminiServiceRef, updateSnapshot, pendingSnapshotIdRef }) => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialSnapshots);
  // Default to selecting only the first snapshot, as per user request to not post all by default
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set([0]));
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [currentSnapIndex, setCurrentSnapIndex] = useState(0);
  
  const [behavior, setBehavior] = useState("");
  const [aiInsight, setAiInsight] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  
  const [saveToJournal, setSaveToJournal] = useState(true);
  const [postToFeed, setPostToFeed] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [showPostOptionsModal, setShowPostOptionsModal] = useState(false);
  
  const [fieldCardBlob, setFieldCardBlob] = useState<Blob | null>(null);
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [resolvedArea, setResolvedArea] = useState<string>("");
  const locationResolvedRef = useRef(false);

  const [objectUrls, setObjectUrls] = useState<Record<string, { image?: string; video?: string; audio?: string }>>({});

  useEffect(() => {
    setSnapshots(initialSnapshots);
  }, [initialSnapshots]);

  useEffect(() => {
    const newUrls: Record<string, { image?: string; video?: string; audio?: string }> = {};
    initialSnapshots.forEach(snap => {
        newUrls[snap.id] = {};
        if (snap.blob) newUrls[snap.id].image = URL.createObjectURL(snap.blob);
        if (snap.videoBlob) newUrls[snap.id].video = URL.createObjectURL(snap.videoBlob);
        if (snap.audioBlob) newUrls[snap.id].audio = URL.createObjectURL(snap.audioBlob);
    });
    setObjectUrls(newUrls);
    return () => {
        Object.values(newUrls).forEach(urls => {
            if (urls.image) URL.revokeObjectURL(urls.image);
            if (urls.video) URL.revokeObjectURL(urls.video);
            if (urls.audio) URL.revokeObjectURL(urls.audio);
        });
    };
  }, [initialSnapshots]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const analyzeCurrent = async () => {
        if (snapshots.length === 0 || !snapshots[currentSnapIndex]) return;
        const current = snapshots[currentSnapIndex];
        
        setBehavior(current.behavior || "");
        setAiInsight(current.aiInsight || "");
        setLabels(current.labels || []);
        
        if (current.isAnalyzing) {
            setIsAnalyzing(true);
            return;
        }

        if (current.aiInsight === "Processing..." || current.aiInsight === "Audio analysis pending..." || current.aiInsight === "Visual record for field study.") {
            if (current.aiInsight === "Processing..." && geminiServiceRef.current?.isConnected() && pendingSnapshotIdRef.current === current.id) {
                setIsAnalyzing(true);
                return; // Let Live API handle it
            }

            setIsAnalyzing(true);
            try {
                const associatedImages = current.associatedImages?.map(i => i.blob).filter(Boolean) as Blob[] || [];
                const mainBlob = current.videoBlob || current.audioBlob || current.blob;
                
                let result;
                if ((current.type === 'audio' || current.type === 'video') && (current.blob || associatedImages.length > 0)) {
                    // Use multimodal analysis for audio/video + images
                    result = await GenAiService.analyzeMultimodal(
                        current.videoBlob || current.audioBlob || null,
                        [current.blob, ...associatedImages].filter(Boolean) as Blob[],
                        resolvedArea || current.location
                    );
                } else {
                    const typeToAnalyze = current.videoBlob ? 'video' : (current.audioBlob ? 'audio' : 'image');
                    result = await GenAiService.analyzeMedia(mainBlob!, typeToAnalyze, resolvedArea || current.location);
                }
                
                if (result) {
                    setAiInsight(result.ecologic);
                    setLabels(result.taxonomy);
                    setTags(result.hashtags);
                    if (result.location && !resolvedArea) setResolvedArea(result.location);

                    setSnapshots(prev => prev.map((s, i) => i === currentSnapIndex ? {
                        ...s,
                        aiInsight: result.ecologic,
                        labels: result.taxonomy,
                        locationArea: result.location,
                    } : s));
                }
            } catch (e) {
                console.error("Analysis failed", e);
            } finally {
                setIsAnalyzing(false);
            }
        }
    };
    analyzeCurrent();
  }, [currentSnapIndex, snapshots, geminiServiceRef, pendingSnapshotIdRef]);

  useEffect(() => {
      if (geminiServiceRef.current && geminiServiceRef.current.isConnected()) {
          geminiServiceRef.current.updateDelegate({
              onTranscript: (text, isUser) => {
                  if (!isUser && pendingSnapshotIdRef.current) {
                      updateSnapshot(pendingSnapshotIdRef.current, { aiInsight: text });
                      if (snapshots[currentSnapIndex]?.id === pendingSnapshotIdRef.current) {
                          setAiInsight(text);
                      }
                  }
              },
              onTurnComplete: () => {
                  pendingSnapshotIdRef.current = null;
                  setIsAnalyzing(false);
              }
          });
      }
  }, [currentSnapIndex, snapshots, updateSnapshot, geminiServiceRef, pendingSnapshotIdRef]);

  useEffect(() => {
    const resolveLocation = async () => {
        if (snapshots.length === 0 || locationResolvedRef.current) return;
        const current = snapshots[currentSnapIndex];
        if (current?.location && !resolvedArea) {
            const isCoords = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(current.location);
            if (!isCoords) {
                setResolvedArea(current.location);
                locationResolvedRef.current = true;
                return;
            }
            try {
                const [lat, lng] = current.location.split(',').map(Number);
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`);
                const data = await res.json();
                if (data.address) {
                    setResolvedArea(data.address.city || data.address.town || data.address.village || data.address.county || data.address.state || "Nearby Wilderness");
                } else {
                    setResolvedArea("Nearby Wilderness");
                }
                locationResolvedRef.current = true;
            } catch (e) { 
                setResolvedArea("Wilderness Area"); 
                locationResolvedRef.current = true;
            }
        }
    };
    resolveLocation();
  }, [snapshots, currentSnapIndex, resolvedArea]);

  useEffect(() => {
    if (snapshots.length > 0 && snapshots[currentSnapIndex]) {
        const current = snapshots[currentSnapIndex];
        const newTags = new Set<string>();
        newTags.add("#FIELDGUIDE");
        if (current.isHybrid) newTags.add("#URBANWILD");
        labels.forEach(l => newTags.add(`#${l.replace(/\s+/g, '').toLowerCase()}`));
        setTags(Array.from(newTags));
    }
  }, [currentSnapIndex, snapshots, behavior, aiInsight, labels]);

  useEffect(() => {
      const prepareFieldCard = async () => {
          if (snapshots.length > 0 && snapshots[currentSnapIndex] && snapshots[currentSnapIndex].type === 'image') {
              setIsGeneratingCard(true);
              const current = snapshots[currentSnapIndex];
              try {
                  const source = current.blob || current.url;
                  const blob = await generateFieldCard(source, labels[0] || "Nature", "FIELD LOG");
                  setFieldCardBlob(blob);
              } catch (e) { console.error(e); } finally { setIsGeneratingCard(false); }
          }
      };
      prepareFieldCard();
  }, [currentSnapIndex, snapshots, labels]);

  const toggleSelection = (idx: number) => {
      const next = new Set(selectedIndices);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      setSelectedIndices(next);
  };

  const handleCopyLink = async () => {
    if (!createdPostId) return;
    let origin = window.location.origin;
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      origin = 'https://ais-pre-jzuicxor5ykd57l4xuevq4-414779155775.asia-east1.run.app';
    }
    const shareUrl = `${origin}/s/${createdPostId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy link:", e);
    }
  };

  const handleFinalizeClick = async () => {
    let activeUserId = FirebaseService.getCurrentUserId();
    if (!activeUserId || activeUserId === 'explorer_guest' || userMode.isAnonymous) {
        setShowAuthModal(true);
        return;
    }
    if (snapshots.length > 0 && selectedIndices.size === 0) return alert("Select at least one observation to log.");
    
    // Check if any selected snapshot is still being analyzed
    const selectedSnapshots = Array.from(selectedIndices).map(idx => snapshots[idx]);
    const isStillAnalyzing = selectedSnapshots.some(s => s.aiInsight === "Processing...");
    
    if (isStillAnalyzing) {
        alert("Please wait for the ecological analysis to complete before finalizing your expedition.");
        return;
    }

    if (selectedIndices.size > 1) {
        setShowPostOptionsModal(true);
    } else {
        executeDispatch('separate');
    }
  };

  const executeDispatch = async (mode: 'stitch' | 'separate') => {
    setShowPostOptionsModal(false);
    setIsProcessing(true);
    try {
        const activeUserId = FirebaseService.getCurrentUserId()!;
        const selectedSnapshots = Array.from(selectedIndices).map(idx => {
            const current = snapshots[idx];
            return { 
                ...current, 
                blob: (idx === currentSnapIndex && fieldCardBlob) ? fieldCardBlob : current.blob, 
                locationArea: resolvedArea, 
                showLocation, 
                behavior: idx === currentSnapIndex ? behavior : current.behavior, 
                aiInsight: idx === currentSnapIndex ? aiInsight : current.aiInsight, 
                labels: idx === currentSnapIndex ? labels : current.labels,
                humanDelta: idx === currentSnapIndex ? (
                    JSON.stringify(labels) !== JSON.stringify(current.aiProposedLabels || []) ||
                    behavior !== (current.aiProposedBehavior || '')
                ) : current.humanDelta || false
            };
        });

        let lastCreatedId = null;
        if (mode === 'stitch') {
            const itemsForSynthesis = selectedSnapshots.map(s => ({ taxonomy: s.labels || [], ecologic: s.aiInsight || '' }));
            const synthesizedData = await GenAiService.synthesizeCollection(itemsForSynthesis);
            const res = await FirebaseService.createSessionObservation(selectedSnapshots, activeUserId, { feed: postToFeed, journal: saveToJournal }, tags, synthesizedData);
            if (res?.id) lastCreatedId = res.id;
        } else {
            for (const snap of selectedSnapshots) {
                const res = await FirebaseService.createSessionObservation([snap], activeUserId, { feed: postToFeed, journal: saveToJournal }, tags);
                if (res?.id) lastCreatedId = res.id;
            }
        }
        if (lastCreatedId) {
            setCreatedPostId(lastCreatedId);
        }

        setIsDone(true);
        
        if (geminiServiceRef.current) {
            geminiServiceRef.current.disconnect();
            geminiServiceRef.current = null;
        }
    } catch (e) { alert("Dispatch failed."); } finally { setIsProcessing(false); }
  };

  if (isDone) {
      return (
          <div className="fixed inset-0 bg-day-bg flex flex-col items-center justify-center p-8 text-center animate-fade-in z-[70]">
               <h2 className="text-4xl font-display italic text-theme-primary mb-4 font-bold tracking-tight">Observations Logged</h2>
               <p className="text-theme-primary/60 mb-12 text-sm font-medium">Findings archived in your persistent record.</p>
               
               {createdPostId && (
                   <button 
                       id="copy_shared_link_btn"
                       onClick={handleCopyLink} 
                       className={`w-full max-w-xs px-8 py-5 rounded-lg font-bold uppercase tracking-widest text-[10px] mb-4 shadow-lg transition-all flex items-center justify-center gap-2 ${copied ? 'bg-emerald-600 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 active:scale-95'}`}
                   >
                       <span className="material-symbols-outlined text-sm">{copied ? 'check_circle' : 'link'}</span>
                       <span>{copied ? 'Link Copied!' : 'Copy Shareable Link'}</span>
                   </button>
               )}

               <button onClick={onViewFeed} className="w-full max-w-xs bg-theme-accent text-white px-8 py-5 rounded-lg font-bold uppercase tracking-widest text-[10px] mb-4 shadow-xl shadow-theme-accent/20">View Ecosystem</button>
               <button onClick={onClose} className="catalog-label hover:opacity-70 transition-opacity">Return to Field</button>
          </div>
      );
  }

  const currentSnapshot = snapshots[currentSnapIndex];
  const currentUrls = currentSnapshot ? objectUrls[currentSnapshot.id] : null;
  const currentPreviewUrl = currentSnapshot ? (currentUrls?.image || currentSnapshot.url) : null;
  const currentVideoUrl = currentSnapshot ? (currentUrls?.video || currentSnapshot.videoUrl) : null;
  const currentAudioUrl = currentSnapshot ? (currentUrls?.audio || currentSnapshot.audioUrl) : null;

  return (
    <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 bg-day-bg flex flex-col z-[70] overflow-hidden"
    >
      <header className="h-16 px-6 flex justify-between items-center bg-white border-b border-theme-primary/10 shrink-0 z-20">
          <button onClick={onClose} className="text-theme-primary/40 hover:text-theme-accent transition-colors"><span className="material-symbols-outlined">close</span></button>
          <div className="text-center">
              <h2 className="text-sm font-display font-black italic text-theme-primary">Review Expedition</h2>
              <p className="catalog-label text-[8px] opacity-40 uppercase tracking-widest">{selectedIndices.size} Observations Selected</p>
          </div>
          <button onClick={onSaveDraft} className="text-theme-accent text-[9px] font-black uppercase tracking-widest px-4 py-2 bg-theme-accent/10 rounded-full hover:bg-theme-accent/20 transition-colors">Save Draft</button>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden relative">
          {/* Primary Media Section - Fixed at top */}
          <div className="w-full bg-theme-shadow shrink-0 flex items-center justify-center relative overflow-hidden group" style={{ height: '45vh' }}>
              {snapshots.length > 0 && currentSnapshot ? (
                  <div className="w-full h-full flex items-center justify-center">
                      {currentSnapshot.type === 'video' ? (
                          <div className="w-full h-full relative flex items-center justify-center">
                              <video 
                                  src={currentVideoUrl!} 
                                  controls 
                                  className="w-full h-full object-contain z-10 transition-transform duration-300"
                                  style={{ transform: `rotate(${currentSnapshot.rotation || 0}deg)` }}
                                  playsInline
                              />
                              <div className="absolute inset-0 opacity-30 blur-3xl scale-110 pointer-events-none">
                                  <video src={currentVideoUrl!} muted className="w-full h-full object-cover transition-transform duration-300" style={{ transform: `rotate(${currentSnapshot.rotation || 0}deg)` }} />
                              </div>
                          </div>
                      ) : currentSnapshot.type === 'audio' ? (
                          <div className="w-full h-full relative flex items-center justify-center">
                              <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5 opacity-40">
                                  {[currentSnapshot.url, ...(currentSnapshot.associatedImages?.map(i => i.url) || [])].filter(Boolean).slice(0, 4).map((url, i, arr) => (
                                      <img 
                                          key={i} 
                                          src={url} 
                                          className={`w-full h-full object-cover ${arr.length === 1 ? 'col-span-2 row-span-2' : arr.length === 2 ? 'row-span-2' : ''}`} 
                                          alt="" 
                                      />
                                  ))}
                                  {[currentSnapshot.url, ...(currentSnapshot.associatedImages?.map(i => i.url) || [])].filter(Boolean).length === 0 && (
                                      <div className="col-span-2 row-span-2 bg-theme-primary flex items-center justify-center">
                                          <span className="material-symbols-outlined text-theme-primary/80 text-6xl">waves</span>
                                      </div>
                                  )}
                              </div>
                              <div className="relative z-10 flex flex-col items-center gap-6 p-8 bg-black/40 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl">
                                  <div className="w-16 h-16 rounded-full bg-theme-accent flex items-center justify-center text-white shadow-lg shadow-theme-accent/40">
                                      <span className="material-symbols-outlined text-3xl">mic</span>
                                  </div>
                                  <audio 
                                      src={currentAudioUrl} 
                                      controls 
                                      className="w-64 h-10" 
                                  />
                                  <p className="text-[10px] font-black text-white/60 uppercase tracking-[0.3em]">Acoustic Signature</p>
                              </div>
                          </div>
                      ) : (
                          <div className="w-full h-full relative flex items-center justify-center">
                              <img 
                                  src={currentPreviewUrl!} 
                                  className="w-full h-full object-contain z-10 transition-transform duration-300" 
                                  alt="Observation" 
                              />
                              <div className="absolute inset-0 opacity-30 blur-3xl scale-110 pointer-events-none">
                                  <img src={currentPreviewUrl!} className="w-full h-full object-cover transition-transform duration-300" alt="" />
                              </div>
                              {currentAudioUrl && (
                                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 bg-black/60 backdrop-blur-xl p-3 rounded-full border border-white/10 shadow-2xl">
                                      <audio src={currentAudioUrl} controls className="h-10 w-64" />
                                  </div>
                              )}
                          </div>
                      )}
                      <button 
                          onClick={() => toggleSelection(currentSnapIndex)} 
                          className={`absolute top-6 right-6 z-30 w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 ${selectedIndices.has(currentSnapIndex) ? 'bg-theme-accent text-white' : 'bg-white/20 backdrop-blur-md text-white border border-white/20'}`}
                      >
                          <span className="material-symbols-outlined text-2xl">{selectedIndices.has(currentSnapIndex) ? 'check_circle' : 'add_circle'}</span>
                      </button>
                      {(currentSnapshot.type === 'image' || currentSnapshot.type === 'video') && (
                          <button 
                              onClick={async () => {
                                  if (currentSnapshot.type === 'image') {
                                      setIsProcessing(true);
                                      try {
                                          const source = currentSnapshot.blob || currentSnapshot.url;
                                          if (source) {
                                              const newBlob = await rotateImageBlob(source, 90);
                                              updateSnapshot(currentSnapshot.id, { blob: newBlob, url: undefined });
                                              setSnapshots(prev => prev.map((s, i) => i === currentSnapIndex ? { ...s, blob: newBlob, url: undefined } : s));
                                              
                                              // Update object URLs
                                              setObjectUrls(prev => ({
                                                  ...prev,
                                                  [currentSnapshot.id]: {
                                                      ...prev[currentSnapshot.id],
                                                      image: URL.createObjectURL(newBlob)
                                                  }
                                              }));
                                          }
                                      } catch (e) {
                                          console.error("Failed to rotate image", e);
                                          alert("Failed to rotate image.");
                                      } finally {
                                          setIsProcessing(false);
                                      }
                                  } else {
                                      const newRotation = ((currentSnapshot.rotation || 0) + 90) % 360;
                                      updateSnapshot(currentSnapshot.id, { rotation: newRotation });
                                      setSnapshots(prev => prev.map((s, i) => i === currentSnapIndex ? { ...s, rotation: newRotation } : s));
                                  }
                              }} 
                              disabled={isProcessing}
                              className="absolute top-6 left-6 z-30 w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 bg-white/20 backdrop-blur-md text-white border border-white/20 disabled:opacity-50"
                          >
                              <span className="material-symbols-outlined text-2xl">rotate_right</span>
                          </button>
                      )}
                  </div>
              ) : (
                  <div className="text-center opacity-20">
                      <span className="material-symbols-outlined text-6xl text-white mb-4">landscape</span>
                      <h3 className="text-xl font-display font-bold italic text-white">No Media Selected</h3>
                  </div>
              )}
          </div>

          {/* Scrollable Content Section */}
          <div className="flex-1 overflow-y-auto overscroll-contain no-scrollbar bg-white">
              <div className="p-6 md:p-10 max-w-2xl mx-auto pb-10">
                  {snapshots.length > 1 && (
                      <div className="mb-10">
                          <div className="flex items-center justify-between mb-4">
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-theme-primary/40">Expedition Timeline</span>
                              <button 
                                  onClick={() => setSelectedIndices(selectedIndices.size === snapshots.length ? new Set() : new Set(snapshots.map((_, i) => i)))}
                                  className="text-[9px] font-black uppercase tracking-widest text-theme-accent hover:text-theme-accent/80"
                              >
                                  {selectedIndices.size === snapshots.length ? 'Deselect All' : 'Select All'}
                              </button>
                          </div>
                          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                              {snapshots.map((snap, i) => (
                                  <button 
                                      key={snap.id} 
                                      onClick={() => setCurrentSnapIndex(i)} 
                                      className={`relative shrink-0 w-20 aspect-square rounded-xl overflow-hidden border-2 transition-all ${currentSnapIndex === i ? 'border-theme-accent scale-105 shadow-lg' : 'border-theme-primary/10 opacity-60 hover:opacity-100'}`}
                                  >
                                      {snap.type === 'audio' ? (
                                          snap.associatedImages && snap.associatedImages.length > 0 ? (
                                              <img src={snap.associatedImages[0].url} className="w-full h-full object-cover" alt="" />
                                          ) : (
                                              <div className="w-full h-full bg-theme-primary flex items-center justify-center">
                                                  <span className="material-symbols-outlined text-theme-accent text-2xl">mic</span>
                                              </div>
                                          )
                                      ) : (
                                          <img 
                                            src={objectUrls[snap.id]?.image || snap.url} 
                                            className="w-full h-full object-cover" 
                                            style={snap.type === 'video' ? { transform: `rotate(${snap.rotation || 0}deg)` } : undefined}
                                            alt="" 
                                          />
                                      )}
                                      {!selectedIndices.has(i) && (
                                          <div className="absolute inset-0 bg-theme-primary/60 flex items-center justify-center">
                                              <span className="material-symbols-outlined text-white text-xs">close</span>
                                          </div>
                                      )}
                                  </button>
                              ))}
                          </div>
                      </div>
                  )}

                  {snapshots.length > 0 && (
                      <div className="space-y-8">
                          <section>
                              <label className="catalog-label text-[9px] mb-3 block opacity-50">Taxonomy & Identification</label>
                              <input 
                                  type="text" 
                                  placeholder="Species Name..."
                                  value={labels.join(', ')} 
                                  onChange={(e) => setLabels(e.target.value.split(',').map(l => l.trim()).filter(Boolean))} 
                                  className="w-full p-4 bg-theme-primary/5 border border-theme-primary/10 rounded-2xl text-[9px] font-black uppercase tracking-widest text-theme-primary outline-none focus:border-theme-accent/30 transition-colors placeholder:text-[9px] placeholder:font-black placeholder:uppercase placeholder:tracking-widest placeholder:text-theme-primary/30"
                              />
                          </section>
                          
                          <section>
                              <label className="catalog-label text-[9px] mb-3 block opacity-50">Ecological Insight</label>
                              <div className="relative">
                                  <textarea 
                                      value={aiInsight} 
                                      onChange={(e) => setAiInsight(e.target.value)} 
                                      placeholder="Describe the observation..."
                                      className={`w-full p-6 bg-theme-accent/5 border rounded-3xl text-base font-display italic text-theme-primary/90 leading-relaxed outline-none resize-none h-48 transition-all ${isAnalyzing && aiInsight === "Processing..." ? 'border-theme-accent/30 animate-pulse' : 'border-theme-accent/20 focus:border-theme-accent/50'}`} 
                                  />
                                  {isAnalyzing && aiInsight === "Processing..." && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px] rounded-3xl pointer-events-none">
                                          <div className="flex flex-col items-center gap-3">
                                              <div className="w-8 h-8 rounded-full border-2 border-theme-accent border-t-transparent animate-spin" />
                                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-theme-accent">Deep Analysis...</span>
                                          </div>
                                      </div>
                                  )}
                              </div>
                          </section>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <section>
                                  <label className="catalog-label text-[9px] mb-3 block opacity-50">Location</label>
                                  <div className="relative">
                                      <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-theme-primary/40 text-sm">location_on</span>
                                      <input 
                                          type="text" 
                                          value={resolvedArea} 
                                          onChange={(e) => setResolvedArea(e.target.value)} 
                                          className="w-full pl-11 pr-4 py-4 bg-theme-primary/5 border border-theme-primary/10 rounded-2xl text-sm font-display text-theme-primary/90 outline-none focus:border-theme-accent/30"
                                      />
                                  </div>
                              </section>

                              <section>
                                  <label className="catalog-label text-[9px] mb-3 block opacity-50">Hashtags</label>
                                  <div className="relative">
                                      <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-theme-primary/40 text-sm">tag</span>
                                      <input 
                                          type="text" 
                                          value={tags.join(' ')} 
                                          onChange={(e) => setTags(e.target.value.split(' ').filter(Boolean))} 
                                          className="w-full pl-11 p-4 bg-theme-primary/5 border border-theme-primary/10 rounded-2xl text-[9px] font-black italic uppercase tracking-widest text-theme-primary outline-none focus:border-theme-accent/30 transition-colors placeholder:text-[9px] placeholder:font-black placeholder:italic placeholder:uppercase placeholder:tracking-widest placeholder:text-theme-primary/30"
                                      />
                                  </div>
                              </section>
                          </div>

                          <div className="flex gap-4 pt-4">
                              <button 
                                  onClick={() => setSaveToJournal(!saveToJournal)} 
                                  className={`flex-1 py-5 border transition-all flex items-center justify-center gap-3 rounded-2xl ${saveToJournal ? 'bg-theme-primary border-theme-primary text-white shadow-xl' : 'bg-white border-theme-primary/10 text-theme-primary/30'}`}
                              >
                                  <span className="material-symbols-outlined text-xl">fingerprint</span>
                                  <span className="text-[10px] font-black uppercase tracking-widest">Journal</span>
                              </button>
                              <button 
                                  onClick={() => setPostToFeed(!postToFeed)} 
                                  className={`flex-1 py-5 border transition-all flex items-center justify-center gap-3 rounded-2xl ${postToFeed ? 'bg-theme-accent border-theme-accent text-white shadow-xl' : 'bg-white border-theme-primary/10 text-theme-primary/30'}`}
                              >
                                  <span className="material-symbols-outlined text-xl">public</span>
                                  <span className="text-[10px] font-black uppercase tracking-widest">Ecosystem</span>
                              </button>
                          </div>
                      </div>
                  )}
              </div>
          </div>

          {/* Static Finalize Button at Bottom */}
          <div className="shrink-0 p-6 bg-white border-t border-theme-primary/10 z-20 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <button 
                  onClick={handleFinalizeClick} 
                  disabled={isGeneratingCard || isProcessing || (Array.from(selectedIndices).some(idx => snapshots[idx]?.aiInsight === "Processing..."))} 
                  className="w-full py-6 bg-theme-accent text-white font-black uppercase tracking-[0.4em] text-[11px] rounded-2xl shadow-2xl shadow-theme-accent/30 disabled:opacity-30 transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                  {isProcessing ? (
                      <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                          <span>Syncing Discovery...</span>
                      </>
                  ) : (Array.from(selectedIndices).some(idx => snapshots[idx]?.aiInsight === "Processing...") ? (
                      <>
                          <span className="material-symbols-outlined animate-pulse">psychology</span>
                          <span>Waiting for Analysis...</span>
                      </>
                  ) : (
                      <>
                          <span className="material-symbols-outlined">send</span>
                          <span>Finalize Expedition</span>
                      </>
                  ))}
              </button>
          </div>
      </main>
      
      {showPostOptionsModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-fade-in">
              <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                  <h3 className="text-2xl font-display italic font-bold text-theme-primary mb-2">Post Options</h3>
                  <p className="text-sm text-theme-primary/60 mb-8">You have selected multiple observations. How would you like to post them?</p>
                  
                  <div className="space-y-4">
                      <button 
                          onClick={() => executeDispatch('separate')}
                          className="w-full p-4 border border-theme-primary/20 rounded-2xl text-left hover:border-theme-accent hover:bg-theme-accent/5 transition-all group"
                      >
                          <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-full bg-theme-primary/10 flex items-center justify-center group-hover:bg-theme-accent/10 group-hover:text-theme-accent transition-colors">
                                  <span className="material-symbols-outlined">grid_view</span>
                              </div>
                              <div>
                                  <div className="font-bold text-theme-primary text-sm">Post Separately</div>
                                  <div className="text-xs text-theme-primary/60">Create {selectedIndices.size} individual posts</div>
                              </div>
                          </div>
                      </button>
                      
                      <button 
                          onClick={() => executeDispatch('stitch')}
                          className="w-full p-4 border border-theme-primary/20 rounded-2xl text-left hover:border-theme-accent hover:bg-theme-accent/5 transition-all group"
                      >
                          <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-full bg-theme-primary/10 flex items-center justify-center group-hover:bg-theme-accent/10 group-hover:text-theme-accent transition-colors">
                                  <span className="material-symbols-outlined">view_carousel</span>
                              </div>
                              <div>
                                  <div className="font-bold text-theme-primary text-sm">Stitch as Collection</div>
                                  <div className="text-xs text-theme-primary/60">Create 1 post with a unified summary</div>
                              </div>
                          </div>
                      </button>
                  </div>
                  
                  <button 
                      onClick={() => setShowPostOptionsModal(false)}
                      className="w-full mt-6 py-4 text-xs font-bold text-theme-primary/40 hover:text-theme-primary/70 uppercase tracking-widest transition-colors"
                  >
                      Cancel
                  </button>
              </div>
          </div>
      )}

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={() => { setShowAuthModal(false); handleFinalizeClick(); }} />}
    </motion.div>
  );
};

export default PostSessionView;
