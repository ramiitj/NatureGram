
import { getShareUrl } from '../utils';
import { PressingLoader } from './SkeletonPost';
import { FungiWarning, isFungiPost } from './AiBadge';
import { WonderBurst } from './Wonder';
import { track } from '../services/analytics';
import React, { useState, useEffect, useRef } from 'react';
import { Snapshot, UserMode } from '../types.ts';
import { FirebaseService, PublishError, getMyAllowance } from '../services/firebaseService.ts';
import { rotateImageBlob } from '../services/imageUtils.ts';
import { GenAiService } from '../services/genAiService.ts';
import { GeminiLiveService } from '../services/geminiLiveService.ts';
import AuthModal from './AuthModal.tsx';
import { motion, useReducedMotion } from 'motion/react';
import Glyph from './Glyph';
import SpecimenPlate, { PlateData, PlateStamp } from './SpecimenPlate';
import { sharePlate } from '../services/plateImage';
import { groupOf, seasonOf } from '../services/lifeList';
import { answersChallenge, carriesChallengeTag } from '../services/challenge';
import { getDailyTheme } from '../constants/naturalists';
import { getNaturalistExtra } from '../constants/naturalistExtras';

interface PostSessionViewProps {
  snapshots: Snapshot[];
  summary: string;
  userMode: UserMode;
  onClose: () => void;
  onViewFeed: () => void;
  onSaveDraft: () => void;
  onCaptureMore?: () => void;
  onPublished?: () => void;
  onRequireAccount?: (reason: string, then?: () => void) => void;
  onUpdateSnapshots?: (snaps: Snapshot[]) => void;
  geminiServiceRef: React.MutableRefObject<GeminiLiveService | null>;
  updateSnapshot: (id: string, updates: Partial<Snapshot>) => void;
  pendingSnapshotIdRef: React.MutableRefObject<string | null>;
  /** Species already on the explorer's life list (common names); merged with a fresh read at publish. */
  knownSpecies?: string[];
}

/** Lines the app writes when a session ends on its own; they are not the guide's notes. */
const SYSTEM_SUMMARY = /^(exploration concluded|we closed the notebook on a good walk|session ended|unfinished expedition|that's today's live time)/i;
const guideNotesOf = (summary?: string) => {
  const t = (summary || '').trim();
  return t && !SYSTEM_SUMMARY.test(t) ? t : '';
};
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The guide's confidence, said in words. */
const confidenceWords = (c?: string | null) =>
  c === 'high' ? 'Your guide is quite sure' : c === 'medium' ? 'Your guide is fairly sure' : c === 'low' ? 'Your guide is not sure' : '';

const ordinal = (n: number) => { const v = n % 100; const suf = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'; return `${n}${suf}`; };
/** A line that marks how far the explorer has come, with the round numbers called out. */
const lifeListMilestone = (total: number, added: number) => {
  if (total === 1) return 'Your first species. Every naturalist\'s list starts with one.';
  const crossed = [5, 10, 25, 50, 100, 250, 500, 1000].find(m => total >= m && total - added < m);
  if (crossed) return total === crossed ? `Your ${ordinal(total)} species. A milestone worth a pause.` : `That makes ${total} species on your life list. You've passed ${crossed}.`;
  return `That makes ${total} species on your life list.`;
};

const PostSessionView: React.FC<PostSessionViewProps> = ({ snapshots: initialSnapshots, summary, userMode, onClose, onViewFeed, onSaveDraft, onCaptureMore, onPublished, onRequireAccount, onUpdateSnapshots, geminiServiceRef, updateSnapshot, pendingSnapshotIdRef, knownSpecies }) => {
  const reduceMotion = useReducedMotion();
  const theme = getDailyTheme();
  const themeExtra = getNaturalistExtra(theme.id);
  const guideNotes = guideNotesOf(summary);
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialSnapshots);
  // Every capture is selected by default; explorers deselect what they don't want to share
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set(initialSnapshots.map((_, i) => i)));
  const [caption, setCaption] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [publishError, setPublishError] = useState('');
  // When a capture is held back: the fix to show, and whether the explorer may ask for a review instead
  const [reviewOffer, setReviewOffer] = useState<null | { mode: 'stitch' | 'separate' }>(null);
  const [heldMessage, setHeldMessage] = useState('');
  const [sharesLeft, setSharesLeft] = useState<number | null>(null);
  useEffect(() => { getMyAllowance().then(a => { if (a) setSharesLeft(Math.max(0, a.posts.limit - a.posts.used)); }); }, []);
  const [newSpecies, setNewSpecies] = useState<string[]>([]);
  const [lifeListTotal, setLifeListTotal] = useState(0);
  const [publishedThumb, setPublishedThumb] = useState<string | null>(null);
  const [plate, setPlate] = useState<PlateData | null>(null);
  const [answeredChallenge, setAnsweredChallenge] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const tagsTouchedRef = useRef(false);
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
  // Several captures post as separate sightings unless the explorer combines them
  const [combine, setCombine] = useState(false);

  const isGeneratingCard = false;
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [resolvedArea, setResolvedArea] = useState<string>("");
  const locationResolvedRef = useRef(false);

  const [objectUrls, setObjectUrls] = useState<Record<string, { image?: string; video?: string; audio?: string }>>({});

  useEffect(() => {
    setSnapshots(initialSnapshots);
  }, [initialSnapshots]);

  // Preview URLs depend only on which media exist, not on text edits (avoids flicker while typing)
  const mediaKey = initialSnapshots.map(s => `${s.id}:${s.blob ? s.blob.size : 0}:${s.videoBlob ? 1 : 0}:${s.audioBlob ? 1 : 0}`).join('|');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  /** Write an edit into the current capture so switching captures never loses it. */
  const persistCurrent = (updates: Partial<Snapshot>) => {
      setSnapshots(prev => prev.map((s, i) => i === currentSnapIndex ? { ...s, ...updates } : s));
  };
  const editLabels = (v: string[]) => { setLabels(v); persistCurrent({ labels: v }); };
  const editInsight = (v: string) => { setAiInsight(v); persistCurrent({ aiInsight: v }); };

  // Keep the parent session in sync (drafts saved from the header include these edits)
  useEffect(() => { onUpdateSnapshots?.(snapshots); }, [snapshots]);

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

        // glossary-ok: matches a stored placeholder from LiveLens
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
                    if (!tagsTouchedRef.current) setTags((result.hashtags || []).map((h: string) => `#${String(h).replace(/^#/, '')}`));
                    if (result.location && !resolvedArea) setResolvedArea(result.location);

                    setSnapshots(prev => prev.map((s, i) => i === currentSnapIndex ? {
                        ...s,
                        aiInsight: result.ecologic,
                        labels: result.taxonomy,
                        ...(result.location ? { locationArea: result.location } : {}),
                        aiProposedLabels: s.aiProposedLabels || result.taxonomy,
                        aiProposedBehavior: s.aiProposedBehavior || result.ecologic,
                        aiConfidence: result.confidence,
                        aiIdentifications: result.identifications,
                        aiFlags: result.flags,
                        needsExpertReview: result.needsExpertReview,
                        aiSafetyNote: result.safetyNote,
                        aiModel: result.model,
                        aiPromptVersion: result.promptVersion,
                        aiResultId: result.resultId,
                        aiError: null,
                    } : s));
                }
            } catch (e: any) {
                console.error("Analysis failed", e);
                setAiInsight('');
                setSnapshots(prev => prev.map((s, i) => i === currentSnapIndex ? { ...s, aiInsight: '', isAnalyzing: false, aiError: e?.message || 'Identification unavailable right now' } : s));
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
    if (tagsTouchedRef.current) return;
    const newTags = new Set<string>();
    snapshots.forEach((snap, i) => {
        if (!selectedIndices.has(i)) return;
        (snap.labels || []).slice(0, 2).forEach(l => {
            const t = l.replace(/\(.*?\)/g, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
            if (t && !/^(unknown|nature|unidentified)/.test(t)) newTags.add(`#${t}`);
        });
        if (snap.isHybrid) newTags.add('#urbanwild');
        if (answersChallenge(theme.id, snap)) newTags.add(themeExtra.challengeTag);
    });
    newTags.add('#naturegram');
    setTags(Array.from(newTags).slice(0, 12));
  }, [snapshots, selectedIndices]);

  const toggleSelection = (idx: number) => {
      const next = new Set(selectedIndices);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      setSelectedIndices(next);
  };

  const handleCopyLink = async () => {
    if (!createdPostId) return;
    const shareUrl = getShareUrl(createdPostId);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy link:", e);
    }
  };

  const anySensitive = Array.from(selectedIndices).some(i => snapshots[i]?.aiFlags?.sensitiveSpecies);
  const anyPeople = Array.from(selectedIndices).some(i => snapshots[i]?.aiFlags?.peopleVisible);
  useEffect(() => { if (anySensitive) setShowLocation(false); }, [anySensitive]);

  const handleFinalizeRef = useRef<() => void>(() => {});
  const handleFinalizeClick = async () => {
    setPublishError('');
    const activeUserId = FirebaseService.getCurrentUserId();
    const isGuest = !activeUserId || activeUserId === 'explorer_guest' || FirebaseService.isCurrentUserAnonymous();
    if (isGuest) {
        if (onRequireAccount) onRequireAccount('Create a free account to publish your sightings and keep them in your journal.', () => handleFinalizeRef.current());
        else setShowAuthModal(true);
        return;
    }
    if (snapshots.length === 0 || selectedIndices.size === 0) { setPublishError('Select at least one capture to share.'); return; }
    const selectedSnapshots = Array.from(selectedIndices).map(idx => snapshots[idx]).filter(Boolean);
    if (selectedSnapshots.some(s => s.aiInsight === "Processing...")) {
        setPublishError('Your guide is still analysing a capture. It will be ready in a moment.');
        return;
    }

    executeDispatch(combine && selectedIndices.size > 1 ? 'stitch' : 'separate');
  };

  handleFinalizeRef.current = handleFinalizeClick;

  const executeDispatch = async (mode: 'stitch' | 'separate', requestReview = false) => {
    setIsProcessing(true);
    setPublishError('');
    setReviewOffer(null);
    let held = '';
    try {
        const activeUserId = FirebaseService.getCurrentUserId()!;
        const before = await FirebaseService.getMySpeciesSet();
        (knownSpecies || []).forEach(n => { if (n) before.add(n.trim().toLowerCase()); });
        const selectedSnapshots = Array.from(selectedIndices).sort((a, b) => a - b).map(idx => {
            const current = snapshots[idx];
            const proposed = current.aiProposedLabels || [];
            return {
                ...current,
                locationArea: resolvedArea,
                showLocation,
                // Human-in-the-loop signal: did the explorer change what the AI proposed?
                humanDelta: proposed.length > 0 && JSON.stringify((current.labels || []).map(l => l.toLowerCase())) !== JSON.stringify(proposed.map(l => l.toLowerCase())),
            };
        });
        const cleanTags = tags.map(t => t.trim()).filter(Boolean);

        let lastCreatedId = null;
        if (mode === 'stitch') {
            const itemsForSynthesis = selectedSnapshots.map(s => ({ taxonomy: s.labels || [], ecologic: s.aiInsight || '' }));
            const synthesizedData = await GenAiService.synthesizeCollection(itemsForSynthesis).catch(() => undefined);
            const res = await FirebaseService.publishPost(selectedSnapshots, activeUserId, { feed: postToFeed, journal: true }, cleanTags, { caption, title: synthesizedData?.title, description: synthesizedData?.description, requestReview });
            if (res?.id) lastCreatedId = res.id;
            if (res?.held) held = res.message || '';
        } else {
            for (const snap of selectedSnapshots) {
                const res = await FirebaseService.publishPost([snap], activeUserId, { feed: postToFeed, journal: true }, cleanTags, { caption, requestReview });
                if (res?.id) lastCreatedId = res.id;
                if (res?.held) held = res.message || '';
            }
        }
        if (lastCreatedId) setCreatedPostId(lastCreatedId);
        setHeldMessage(held);
        FirebaseService.logAiFeedback(selectedSnapshots, lastCreatedId).catch(() => {});
        const fresh = Array.from(new Set(selectedSnapshots.map(s => (s.labels?.[0] || '').trim()).filter(l => l && !/^(unknown|nature|unidentified)/i.test(l) && !before.has(l.toLowerCase()))));
        setNewSpecies(fresh);
        setLifeListTotal(before.size + fresh.length);
        const first = selectedSnapshots[0];
        const thumb = first ? (objectUrls[first.id]?.image || first.url || first.associatedImages?.[0]?.url || null) : null;
        setPublishedThumb(thumb);
        // The plate: the first new species if there is one, otherwise the first sighting shared
        const plateSnap = (fresh[0] && selectedSnapshots.find(s => (s.labels?.[0] || '').trim() === fresh[0])) || first;
        const plateName = (plateSnap?.labels?.[0] || '').trim();
        if (plateSnap && plateName && !/^(unknown|nature|unidentified)/i.test(plateName)) {
            const sci = [plateSnap.labels?.[1], plateSnap.aiIdentifications?.[0]?.scientificName].find(x => !!x && /^[A-Z][a-z]+ [a-z]+/.test(x));
            const now = Date.now();
            setPlate({
                name: plateName, scientific: sci || undefined,
                thumb: (objectUrls[plateSnap.id]?.image || plateSnap.url || plateSnap.associatedImages?.[0]?.url) || undefined,
                no: fresh.length ? before.size + 1 : undefined,
                firstMs: (plateSnap as any).takenAtMs || now,
                place: showLocation && !plateSnap.aiFlags?.sensitiveSpecies ? (resolvedArea || undefined) : undefined,
                season: seasonOf((plateSnap as any).takenAtMs || now, plateSnap.rawLocation?.lat),
                group: groupOf(plateSnap),
            });
        } else setPlate(null);
        setAnsweredChallenge(carriesChallengeTag(theme.id, cleanTags));
        setIsDone(true);
        onPublished?.();
        track('post_published', {
            count: selectedSnapshots.length, mode, audience: postToFeed ? 'public' : 'journal',
            corrected: selectedSnapshots.filter(s => s.humanDelta).length, caption: caption.length > 0, new_species: fresh.length,
        });

        if (geminiServiceRef.current) {
            geminiServiceRef.current.disconnect();
            geminiServiceRef.current = null;
        }
    } catch (e) {
        console.error('Publish failed', e);
        if (e instanceof PublishError) {
            // The server says what to fix: crop, retake, change the words, or wait for tomorrow's allowance
            track('post_held', { code: e.code });
            setPublishError(e.message);
            if (e.details?.canRequestReview) setReviewOffer({ mode });
            return;
        }
        track('post_publish_failed', { offline: navigator.onLine === false });
        setPublishError(navigator.onLine === false
            ? "You're offline. Your captures are safe here. Reconnect and tap Share again, or save a draft."
            : "We couldn't publish just now. Your captures are safe. Please try again or save a draft.");
    } finally { setIsProcessing(false); }
  };

  if (isDone) {
      const shareLink = async () => {
          if (!createdPostId) return;
          const url = getShareUrl(createdPostId);
          try {
              if (navigator.share) await navigator.share({ title: newSpecies[0] ? `I spotted a ${newSpecies[0]} on NatureGram` : 'My NatureGram sighting', url });
              else handleCopyLink();
          } catch { /* cancelled */ }
      };
      // Share the plate itself; a bare link only when the plate can't be drawn
      const share = async () => {
          if (!createdPostId) return;
          if (!plate) return shareLink();
          setShareNote('');
          const url = getShareUrl(createdPostId);
          const res = await sharePlate({ ...plate, line: answeredChallenge ? `Answers ${theme.naturalist}'s challenge` : undefined }, { text: `${plate.name}, from my field page on NatureGram`, url });
          if (res === 'failed') return shareLink();
          // glossary-ok: the life-list plate image
          if (res === 'downloaded') setShareNote('Plate saved to your device.');
      };
      const isNew = newSpecies.length > 0;
      return (
          <div className="fixed inset-0 bg-day-bg flex flex-col items-center px-6 py-8 pt-[calc(env(safe-area-inset-top)+3rem)] text-center animate-fade-in z-[70] overflow-y-auto">
               {plate ? (
                   <motion.div
                       className="relative w-56 mb-7 shrink-0"
                       initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
                       animate={{ opacity: 1, y: 0 }}
                       transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1], delay: reduceMotion ? 0 : 0.1 }}
                   >
                       {isNew && <span className="absolute -inset-16 pointer-events-none"><WonderBurst count={24} /></span>}
                       <SpecimenPlate data={plate} size="lg" stamp={isNew ? <PlateStamp>First for your list</PlateStamp> : undefined} />
                   </motion.div>
               ) : publishedThumb && (
                   <div className="relative mb-6">
                       <img src={publishedThumb} alt="" className="w-40 h-40 rounded-md object-cover" />
                   </div>
               )}
               {plate?.no && <p className="ng-kicker mb-3">No. {plate.no} in your collection</p>}
               <h2 className="ng-display mb-3">{postToFeed && !heldMessage ? 'Shared with everyone' : 'In your journal'}</h2>
               <p className="ng-body text-stone-600 mb-5 max-w-xs">{heldMessage || (postToFeed ? 'Explorers everywhere can now see what you found and learn from it.' : 'Only you can see it. You can share it with everyone any time.')}</p>
               {isNew && lifeListTotal > 0 && <p className="ng-small text-stone-700 mb-5 max-w-xs">{newSpecies.length > 1 ? `New to your list: ${newSpecies.join(', ')}. ` : ''}{lifeListMilestone(lifeListTotal, newSpecies.length)}</p>}
               {answeredChallenge && (
                   <p className="mb-5 flex items-center justify-center gap-2 text-sm text-stone-800"><Glyph name="stamp" size={20} className="text-stone-500" />You answered {theme.naturalist}'s challenge</p>
               )}
               {guideNotes && (
                   <figure className="mb-8 w-full max-w-xs text-left border-l border-theme-accent pl-5">
                       <figcaption className="ng-caption mb-1.5 flex items-center gap-1.5"><Glyph name="guide" size={14} />Your guide's notes</figcaption>
                       <p className="font-display italic text-base leading-[1.6] text-stone-700 line-clamp-5">{guideNotes}</p>
                   </figure>
               )}
               <div className="w-full max-w-xs flex flex-col items-center gap-4 pb-6">
                   {createdPostId && postToFeed && !heldMessage && (
                       <button onClick={share} className="ng-button-primary w-full">
                           <Glyph name="share" size={20} className="ng-arrow" />{/* glossary-ok: the life-list plate */}
                           {copied ? 'Link copied' : plate ? 'Share the plate' : 'Share'}
                       </button>
                   )}
                   {shareNote && <p className="ng-caption" role="status">{shareNote}</p>}
                   <button onClick={onViewFeed} className={createdPostId && postToFeed && !heldMessage ? 'ng-button-quiet w-full' : 'ng-button-primary w-full'}>See it in the wild</button>
                   {onCaptureMore && <button onClick={onCaptureMore} className="ng-link-quiet min-h-[44px] inline-flex items-center gap-2"><Glyph name="eyeEar" size={20} className="text-stone-500" />Keep looking</button>}
               </div>
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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
        className="fixed inset-0 bg-day-bg flex flex-col z-[70] overflow-hidden"
    >
      <header className="h-16 px-4 md:px-8 flex justify-between items-center bg-day-bg border-b border-stone-200/80 shrink-0 z-20 safe-pt box-content">
          <button onClick={() => snapshots.length ? setConfirmLeave(true) : onClose()} aria-label="Close review" className="ng-icon-button -ml-2"><Glyph name="close" size={24} /></button>
          <div className="text-center">
              <h2 className="font-display italic text-lg text-stone-900">{selectedIndices.size > 1 && !combine ? 'Your sightings' : 'Your sighting'}</h2>
              {snapshots.length > 1 && <p className="ng-caption">{selectedIndices.size} of {snapshots.length} captures selected</p>}
          </div>
          <span className="w-11" aria-hidden="true" />
      </header>

      <main className="flex-1 flex flex-col overflow-hidden relative">
          {/* Primary Media Section - Fixed at top */}
          <div className="w-full bg-stone-950 shrink-0 flex items-center justify-center relative overflow-hidden group" style={{ height: '45vh' }}>
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
                                      <div className="col-span-2 row-span-2 bg-stone-900 flex items-center justify-center">
                                          <Glyph name="sound" size={40} strokeWidth={1.2} className="text-white/60" />
                                      </div>
                                  )}
                              </div>
                              <div className="relative z-10 flex flex-col items-center gap-5 p-8 bg-black/45 backdrop-blur-xl rounded-2xl">
                                  <Glyph name="sound" size={32} className="text-white/85" />
                                  <audio
                                      src={currentAudioUrl}
                                      controls
                                      className="w-64 h-10"
                                  />
                                  <p className="text-sm font-display italic text-white/75">Sound</p>
                              </div>
                          </div>
                      ) : (
                          <div className="w-full h-full relative flex items-center justify-center">
                              <img
                                  src={currentPreviewUrl!}
                                  className="w-full h-full object-contain z-10 transition-transform duration-300"
                                  alt="Your capture"
                              />
                              <div className="absolute inset-0 opacity-30 blur-3xl scale-110 pointer-events-none">
                                  <img src={currentPreviewUrl!} className="w-full h-full object-cover transition-transform duration-300" alt="" />
                              </div>
                              {currentAudioUrl && (
                                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-black/45 backdrop-blur-xl p-2 rounded-full">
                                      <audio src={currentAudioUrl} controls className="h-10 w-64" />
                                  </div>
                              )}
                          </div>
                      )}
                      <button
                          onClick={() => toggleSelection(currentSnapIndex)}
                          aria-pressed={selectedIndices.has(currentSnapIndex)}
                          aria-label={selectedIndices.has(currentSnapIndex) ? 'Selected to share. Tap to leave out' : 'Not selected. Tap to include'}
                          className={`absolute top-4 right-4 md:top-6 md:right-6 z-30 w-12 h-12 rounded-full flex items-center justify-center transition-colors ${selectedIndices.has(currentSnapIndex) ? 'bg-white text-stone-900' : 'bg-black/40 backdrop-blur-md text-white'}`}
                      >
                          <Glyph name={selectedIndices.has(currentSnapIndex) ? 'checkCircle' : 'plusCircle'} size={24} />
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
                                          setPublishError("Couldn't rotate that image.");
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
                              aria-label="Rotate 90 degrees"
                              className="absolute top-4 left-4 md:top-6 md:left-6 z-30 w-12 h-12 rounded-full flex items-center justify-center transition-colors bg-black/40 backdrop-blur-md text-white disabled:opacity-50"
                          >
                              <Glyph name="rotate" size={24} />
                          </button>
                      )}
                  </div>
              ) : (
                  <div className="text-center text-white/50">
                      <Glyph name="landscape" size={40} strokeWidth={1.2} className="mb-4" />
                      <h3 className="font-display italic text-xl">No captures in this session</h3>
                  </div>
              )}
          </div>

          {/* Scrollable Content Section */}
          <div className="flex-1 overflow-y-auto overscroll-contain no-scrollbar bg-day-bg">
              <div className="px-6 py-8 md:p-12 max-w-2xl mx-auto pb-12">
                  {guideNotes && (
                      <section className="mb-10 border-l border-theme-accent pl-5" aria-labelledby="guide-notes-title">
                          <h3 id="guide-notes-title" className="ng-caption mb-2 flex items-center gap-1.5"><Glyph name="guide" size={14} />Your guide's notes from this outing</h3>
                          <p className="font-display italic text-base leading-[1.6] text-stone-700">{guideNotes}</p>
                      </section>
                  )}
                  {snapshots.length > 1 && (
                      <div className="mb-10">
                          <div className="flex items-center justify-between mb-4">
                              <span className="ng-label">Your captures</span>
                              <button
                                  onClick={() => setSelectedIndices(selectedIndices.size === snapshots.length ? new Set() : new Set(snapshots.map((_, i) => i)))}
                                  className="ng-link-quiet min-h-[44px]"
                              >
                                  {selectedIndices.size === snapshots.length ? 'Deselect all' : 'Select all'}
                              </button>
                          </div>
                          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                              {snapshots.map((snap, i) => (
                                  <button
                                      key={snap.id}
                                      onClick={() => setCurrentSnapIndex(i)}
                                      className={`relative shrink-0 w-20 aspect-square rounded-md overflow-hidden transition-opacity ring-offset-2 ring-offset-day-bg ${currentSnapIndex === i ? 'ring-2 ring-stone-900' : 'opacity-60 hover:opacity-100'}`}
                                  >
                                      {snap.type === 'audio' ? (
                                          snap.associatedImages && snap.associatedImages.length > 0 ? (
                                              <img src={snap.associatedImages[0].url} className="w-full h-full object-cover" alt="" />
                                          ) : (
                                              <div className="w-full h-full bg-stone-900 flex items-center justify-center">
                                                  <Glyph name="sound" size={24} className="text-white/80" />
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
                                          <div className="absolute inset-0 bg-stone-900/60 flex items-center justify-center">
                                              <Glyph name="close" size={14} className="text-white" />
                                          </div>
                                      )}
                                  </button>
                              ))}
                          </div>
                      </div>
                  )}

                  {snapshots.length > 0 && (
                      <div className="space-y-7">
                          {/* 1. The name, pre-filled by the guide, with its confidence in words */}
                          <section>
                              <label htmlFor="post-labels" className="block ng-label mb-2">What did you see?</label>
                              <input
                                  id="post-labels"
                                  type="text"
                                  placeholder="e.g. Indian peafowl"
                                  value={labels[0] || ''}
                                  onChange={(e) => editLabels([e.target.value, ...labels.slice(1)])}
                                  onBlur={() => editLabels(labels.map(l => (l || '').trim()).filter(Boolean))}
                                  aria-describedby="post-labels-hint"
                                  className="ng-field-line text-[28px] leading-[1.2] font-display italic"
                              />
                              <p id="post-labels-hint" className="ng-caption mt-2 flex items-center gap-1.5">
                                  {isAnalyzing
                                      ? <><span className="inline-flex" aria-hidden="true"><Glyph name="guide" size={14} /></span>Your guide is looking…</>
                                      : <>{confidenceWords(currentSnapshot?.aiConfidence) && <><Glyph name="guide" size={14} className="text-stone-500" /><span className="text-stone-700">{confidenceWords(currentSnapshot?.aiConfidence)}.</span></>}<span>Change it if it's wrong.</span></>}
                              </p>
                          </section>

                          {/* Safety notes stay in view */}
                          {((isFungiPost({ labels }) || currentSnapshot?.aiFlags?.fungi) || currentSnapshot?.aiError || currentSnapshot?.aiFlags?.isNatureSubject === false || (currentSnapshot?.needsExpertReview && !currentSnapshot?.aiError) || (currentSnapshot?.aiSafetyNote && !currentSnapshot?.aiFlags?.fungi) || anySensitive || anyPeople) && (
                              <div className="space-y-3 -mt-3">
                                  {(isFungiPost({ labels }) || currentSnapshot?.aiFlags?.fungi) && <FungiWarning />}
                                  {currentSnapshot?.aiError && (
                                      <p className="text-sm text-amber-950 border-l-2 border-amber-600 pl-3.5 py-1 leading-[1.6]">{currentSnapshot.aiError}. Add your own name above. You know what you saw.</p>
                                  )}
                                  {currentSnapshot?.aiFlags && currentSnapshot.aiFlags.isNatureSubject === false && (
                                      <p className="text-sm text-amber-950 border-l-2 border-amber-600 pl-3.5 py-1 leading-[1.6]">This doesn't look like a nature sighting. NatureGram is for wild plants, animals, fungi and natural sounds.</p>
                                  )}
                                  {currentSnapshot?.needsExpertReview && !currentSnapshot?.aiError && (
                                      <p className="text-sm text-stone-700 border-l border-stone-300 pl-3.5 py-1 leading-[1.6]"><strong className="font-semibold">Low certainty.</strong> Check the name before sharing. Once shared, other explorers can confirm or suggest a better name.</p>
                                  )}
                                  {currentSnapshot?.aiSafetyNote && !currentSnapshot?.aiFlags?.fungi && (
                                      <p className="text-sm text-red-900 border-l-2 border-red-700 pl-3.5 py-1 leading-[1.6]">{currentSnapshot.aiSafetyNote}</p>
                                  )}
                                  {anySensitive && <p className="text-sm text-stone-700 border-l border-stone-300 pl-3.5 py-1 leading-[1.6] flex gap-2"><Glyph name="shield" size={20} className="text-stone-500 shrink-0" /><span>Location hidden: this may be a sensitive or threatened species. Sharing where it lives can put it at risk.</span></p>}
                                  {anyPeople && (
                                      <p className="text-sm text-stone-700 border-l border-stone-300 pl-3.5 py-1 leading-[1.6] flex gap-2"><Glyph name="person" size={20} className="text-stone-500 shrink-0" /><span>People may be visible in a capture. Only share it publicly if they're happy to appear.</span></p>
                                  )}
                              </div>
                          )}

                          {/* 2. One thing about it */}
                          <section>
                              <label htmlFor="post-caption" className="block ng-label mb-2">Your note</label>
                              <textarea
                                  id="post-caption"
                                  value={caption}
                                  onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
                                  placeholder="What did you notice? What was it doing?"
                                  rows={3}
                                  className="ng-field w-full p-4 leading-[1.65] resize-none"
                              />
                              {caption.length > 1800 && <p className="ng-caption text-right mt-1 tabular">{caption.length}/2200</p>}
                          </section>

                          {/* 3. Who can see it */}
                          <fieldset>
                              <legend className="block ng-label mb-2">Who can see it?</legend>
                              <div className="grid grid-cols-2 gap-3">
                                  {([
                                      { v: true, icon: 'public', title: 'Share with everyone', desc: 'Everyone on NatureGram, and your journal' },
                                      { v: false, icon: 'fingerprint', title: 'Only me', desc: 'Just in your journal' },
                                  ]).map(opt => (
                                      <label key={String(opt.v)} className={`cursor-pointer p-4 rounded-xl border transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-theme-accent/40 ${postToFeed === opt.v ? 'border-stone-900' : 'border-stone-200 hover:border-stone-300'}`}>
                                          <input type="radio" name="audience" className="sr-only" checked={postToFeed === opt.v} onChange={() => setPostToFeed(opt.v)} />
                                          <span className="flex items-center gap-2 font-medium text-stone-900">{opt.icon === 'fingerprint' ? <Glyph name="rings" size={20} /> : <Glyph name="globe" size={20} />}{opt.title}</span>
                                          <span className="block ng-caption mt-1">{opt.desc}</span>
                                      </label>
                                  ))}
                              </div>
                          </fieldset>

                          {selectedIndices.size > 1 && (
                              <label className="flex items-center justify-between gap-4 cursor-pointer border-y border-stone-200/80 py-4">
                                  <span className="min-w-0">
                                      <span className="block font-medium text-stone-900 text-sm">Combine into one sighting</span>
                                      <span className="block ng-caption mt-0.5">{combine ? `All ${selectedIndices.size} captures together, with a few lines on the outing` : `${selectedIndices.size} separate sightings, each with its own name`}</span>
                                  </span>
                                  <input type="checkbox" role="switch" checked={combine} onChange={e => setCombine(e.target.checked)} className="sr-only peer" />
                                  <span aria-hidden="true" className={`relative shrink-0 w-11 h-6 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[rgb(var(--theme-accent-rgb))] ${combine ? 'bg-stone-900' : 'bg-stone-300'}`}>
                                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${combine ? 'left-[22px]' : 'left-0.5'}`} />
                                  </span>
                              </label>
                          )}

                          {/* Everything else, already filled in by the guide */}
                          <details className="group border-y border-stone-200/80">
                              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 min-h-[56px] font-medium text-stone-800 text-sm">
                                  <span>More details <span className="font-normal text-stone-500">· filled in by your guide</span></span>
                                  <Glyph name="chevronDown" size={20} className="text-stone-500 transition-transform group-open:rotate-180" />
                              </summary>
                              <div className="pb-6 pt-2 space-y-7">
                                  <section>
                                      <label htmlFor="post-scientific" className="block ng-label mb-2">Scientific name</label>
                                      <input
                                          id="post-scientific"
                                          type="text"
                                          placeholder="If you know it"
                                          value={labels[1] || ''}
                                          onChange={(e) => editLabels([labels[0] || '', e.target.value, ...labels.slice(2)])}
                                          onBlur={() => editLabels(labels.map(l => (l || '').trim()).filter(Boolean))}
                                          className="ng-field w-full px-4 py-3 font-display italic placeholder:not-italic"
                                      />
                                  </section>

                                  {!!currentSnapshot?.aiIdentifications?.length && (
                                      <section className="border-l border-stone-300 pl-4 text-sm text-stone-700 leading-[1.6]">
                                          <h4 className="ng-label">Why your guide thinks so</h4>
                                          <ul className="mt-2 space-y-2">
                                              {currentSnapshot.aiIdentifications.map((id, i) => (
                                                  <li key={i}><strong>{id.commonName}</strong>{id.scientificName && <em className="text-stone-500"> · {id.scientificName}</em>} <span className="text-xs text-stone-500">({id.rank}, {id.confidence} confidence)</span><br />{id.evidence}</li>
                                              ))}
                                          </ul>
                                      </section>
                                  )}

                                  <section>
                                      <label htmlFor="post-insight" className="block ng-label mb-2">Why it does this <span className="font-normal text-stone-500">(a draft, edit freely)</span></label>
                                      <div className="relative">
                                          <textarea
                                              id="post-insight"
                                              value={aiInsight}
                                              onChange={(e) => editInsight(e.target.value)}
                                              placeholder="What it was doing, and why"
                                              className={`ng-field w-full p-4 font-display leading-[1.6] resize-none h-36 ${isAnalyzing && aiInsight === "Processing..." ? 'opacity-60' : ''}`}
                                          />
                                          {isAnalyzing && aiInsight === "Processing..." && (
                                              <div className="absolute inset-0 flex items-center justify-center rounded-lg pointer-events-none" role="status">
                                                  <div className="flex flex-col items-center gap-3">
                                                      <PressingLoader size={28} />
                                                      <span className="text-sm font-display italic text-stone-700">Your guide is analysing…</span>
                                                  </div>
                                              </div>
                                          )}
                                      </div>
                                  </section>

                                  <section>
                                      <div className="flex items-center justify-between mb-2">
                                          <label htmlFor="post-location" className="ng-label">Location</label>
                                          <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer min-h-[44px]">
                                              <input
                                                  type="checkbox"
                                                  checked={showLocation}
                                                  onChange={(e) => setShowLocation(e.target.checked)}
                                                  className="w-4 h-4 accent-stone-900"
                                              />
                                              Show area
                                          </label>
                                      </div>
                                      <div className={`relative transition-opacity ${showLocation ? '' : 'opacity-40'}`}>
                                          <Glyph name="pin" size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-500" />
                                          <input
                                              id="post-location"
                                              type="text"
                                              value={resolvedArea}
                                              disabled={!showLocation}
                                              onChange={(e) => setResolvedArea(e.target.value)}
                                              className="ng-field w-full pl-11 pr-4 py-3"
                                          />
                                      </div>
                                      <p className="ng-caption mt-2">Only the approximate area is shown. Exact GPS is never public. It stays in your journal, just for you.</p>
                                      {(currentSnapshot as any)?.takenAtMs && <p className="ng-caption mt-2 flex items-center gap-1.5"><Glyph name="sun" size={14} className="text-stone-400" />Taken {shortDate((currentSnapshot as any).takenAtMs)}</p>}
                                  </section>

                                  <section>
                                      <label htmlFor="post-tags" className="block ng-label mb-2">Hashtags</label>
                                      <div className="relative">
                                          <Glyph name="tag" size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-500" />
                                          <input
                                              id="post-tags"
                                              type="text"
                                              value={tags.join(' ')}
                                              onChange={(e) => { tagsTouchedRef.current = true; setTags(e.target.value.split(/\s+/).map(t => t && !t.startsWith('#') ? `#${t}` : t)); }}
                                              placeholder="#birding #monsoon"
                                              className="ng-field w-full pl-11 pr-4 py-3"
                                          />
                                      </div>
                                  </section>
                              </div>
                          </details>
                      </div>
                  )}
              </div>
          </div>

          {/* Static Finalize Button at Bottom */}
          <div className="shrink-0 px-6 pt-4 bg-day-bg border-t border-stone-200/80 z-20 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {sharesLeft !== null && !publishError && (
                  <p className="mb-3 ng-caption text-center">
                      {sharesLeft === 0 ? "You've shared today's sightings. Save this one as a draft and share it tomorrow." : `You can share ${sharesLeft} more sighting${sharesLeft === 1 ? '' : 's'} today.`}
                  </p>
              )}
              {publishError && (
                  <div role="alert" className="mb-3 text-sm text-stone-800 border-l-2 border-amber-600 pl-3.5 py-1 leading-[1.6]">
                      <p>{publishError}</p>
                      {reviewOffer && (
                          <button onClick={() => executeDispatch(reviewOffer.mode, true)} disabled={isProcessing} className="mt-1 ng-link-quiet min-h-[44px]">
                              I think this is fine. Ask for a review
                          </button>
                      )}
                  </div>
              )}
              <button
                  onClick={handleFinalizeClick}
                  disabled={isProcessing || selectedIndices.size === 0 || (Array.from(selectedIndices).some(idx => snapshots[idx]?.aiInsight === "Processing..."))}
                  aria-busy={isProcessing}
                  className="ng-button-primary w-full max-w-2xl mx-auto flex min-h-[52px] text-base"
              >
                  {isProcessing ? (
                      <>
                          <span className="w-4 h-4 border-[1.5px] border-white/80 border-t-transparent animate-spin rounded-full" aria-hidden="true" />
                          <span>Publishing…</span>
                      </>
                  ) : (Array.from(selectedIndices).some(idx => snapshots[idx]?.aiInsight === "Processing...") ? (
                      <>
                          <span className="inline-flex" aria-hidden="true"><Glyph name="guide" size={20} /></span>
                          <span>Waiting for your guide…</span>
                      </>
                  ) : (
                      <>
                          {postToFeed ? <Glyph name="globe" size={20} className="ng-arrow" /> : <Glyph name="rings" size={20} className="ng-arrow" />}
                          <span>{selectedIndices.size === 0 ? 'Select a capture' : postToFeed ? (selectedIndices.size > 1 && !combine ? `Share ${selectedIndices.size} sightings` : 'Share') : 'Save for only me'}</span>
                      </>
                  ))}
              </button>
          </div>
      </main>

      {confirmLeave && (
          <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center ng-scrim animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="leave-title">
              <div className="w-full sm:max-w-sm ng-sheet p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] animate-slide-up">
                  <h3 id="leave-title" className="ng-subtitle">Save your {snapshots.length} capture{snapshots.length === 1 ? '' : 's'}?</h3>
                  <p className="ng-small mt-1 mb-6">Save a draft to finish later, or discard them for good.</p>
                  <div className="flex flex-col items-center gap-3">
                      <button autoFocus onClick={() => { setConfirmLeave(false); onSaveDraft(); }} className="ng-button-primary w-full">Save draft</button>
                      <button onClick={() => setConfirmLeave(false)} className="ng-button-quiet w-full">Keep editing</button>
                      <button onClick={() => { setConfirmLeave(false); onClose(); }} className="min-h-[44px] px-4 text-sm font-medium text-red-800 underline decoration-red-200 underline-offset-[6px] hover:decoration-red-800">Discard</button>
                  </div>
              </div>
          </div>
      )}

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={() => { setShowAuthModal(false); setTimeout(() => handleFinalizeRef.current(), 300); }} />}
    </motion.div>
  );
};

export default PostSessionView;
