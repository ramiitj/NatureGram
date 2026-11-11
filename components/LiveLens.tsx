
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GeminiLiveService } from '../services/geminiLiveService.ts';
import AudioVisualizer from './AudioVisualizer.tsx';
import { Snapshot, GeminiConfig, UserMode, ChatMessage, GroundingLink, AudioMode } from '../types.ts';
import { compressImageToBlob } from '../services/audioUtils.ts';
import { FirebaseService, getMyAllowance } from '../services/firebaseService.ts';
import { track } from '../services/analytics';
import { getDailyTheme as getDailyThemeConst } from '../constants/naturalists';
import { getNaturalistExtra } from '../constants/naturalistExtras';
import { coarsenCoordinate, canCleanImage, UNCLEANABLE_IMAGE_MESSAGE } from '../utils';
import { GenAiService, tooLargeToAnalyse } from '../services/genAiService.ts';
import { useBackToClose } from '../services/overlayStack';
import { RateLimitService } from '../services/rateLimitService.ts';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import Glyph from './Glyph';
import { PlateStamp } from './SpecimenPlate';
import { isOnList } from '../services/lifeList';
import { answersChallenge } from '../services/challenge';

/** The guide's one motif: a dot breathing inside a ring. Still when the explorer prefers reduced motion. */
const BREATHE_CSS = `@keyframes ng-guide-breathe{0%,100%{transform:scale(.86);opacity:.65}50%{transform:scale(1.08);opacity:1}}.ng-breathe{animation:ng-guide-breathe 2.6s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion: reduce){.ng-breathe{animation:none}}
@keyframes ng-pin-in{from{opacity:0;transform:translateY(18px) rotate(0deg) scale(.9)}to{opacity:1}}.ng-pin{animation:ng-pin-in .6s cubic-bezier(.2,.8,.2,1) both}@media (prefers-reduced-motion: reduce){.ng-pin{animation:none}}
.ng-zoom{-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer}.ng-zoom:focus-visible{outline:2px solid #fff;outline-offset:4px;border-radius:9999px}
.ng-zoom::-webkit-slider-runnable-track{height:2px;background:rgba(255,255,255,.6);border-radius:2px}.ng-zoom::-moz-range-track{height:2px;background:rgba(255,255,255,.6);border-radius:2px}
.ng-zoom::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;margin-top:-9px;border-radius:9999px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.45)}.ng-zoom::-moz-range-thumb{width:20px;height:20px;border:0;border-radius:9999px;background:#fff}`;
const BreathingGuide: React.FC<{ size?: number; still?: boolean; className?: string }> = ({ size = 14, still, className = '' }) => (
  <span className={`inline-flex ${still ? '' : 'ng-breathe'} ${className}`} aria-hidden="true"><Glyph name="guide" size={size} /></span>
);

/** What the guide needs to identify one capture (kept so an offline failure can be tried again). */
type IdJob = { multimodal: boolean; media: Blob | null; images: Blob[]; mediaType: 'image' | 'audio' | 'video'; location?: string; trackType: string };

/** Placeholder labels a capture carries before (or without) an identification. */
const UNNAMED = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting|manual observation|audio recording|video recording|uploaded discovery)/i;
const PLACEHOLDER_TEXT = /^(captured (photo|audio|video)|captured \w+ snippet|uploaded media|manual observation captured|visual record for field study|processing)/i;
/** One sentence, the way a specimen tag carries one line. */
const oneSentence = (t?: string) => {
  const s = (t || '').trim();
  if (!s || PLACEHOLDER_TEXT.test(s)) return '';
  const m = s.match(/^.*?[.!?](\s|$)/);
  const first = (m ? m[0] : s).trim();
  return first.length > 180 ? `${first.slice(0, 177).trimEnd()}…` : first;
};

interface SightingCard {
  id: string;
  name: string;
  scientific?: string;
  line: string;
  firstForList: boolean;
  challenge: string | null;
  /** How sure the guide is, said in words on the tag */
  confidence?: 'high' | 'medium' | 'low' | null;
  /** A safety or danger note (fungi, venomous, ...) that must stay on the tag */
  safety?: string;
}

/** The guide's confidence as the first words of the tag. */
const confidenceLead = (c?: string | null) => c === 'high' ? 'Probably' : c === 'medium' ? 'Could be' : 'Not sure: maybe';

/** Said once: the guide is an AI and can be wrong. */
const AI_LINE = 'Your guide is an AI. It can be wrong; check what matters.';
/** The first-visit line already says it; this marks the first "Talk with me" too. */
const TALK_AI_KEY = 'naturegram_talk_ai_note';
/** The quiet Lens may wait in the background this long (checking a message) before it ends. */
const BACKGROUND_GRACE_MS = 60_000;

/** Why the live guide stopped, in plain words, when we know. */
const liveFailureReason = (err?: any) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "You're offline, so your guide can't talk.";
  const code = Number(err?.code) || 0;
  // The server's own refusals (allowance used, time limit, too many at once) carry words meant for people
  if (code >= 4000 && code <= 4999 && err?.message && !/^(the live guide session ended\.?|session|timeout)/i.test(err.message)) return String(err.message);
  if (code === 4429 || code === 4408) return "Today's live time is used.";
  return 'Your guide is unavailable right now.';
};

/** Distance in km between two points (enough for "moved more than a kilometre"). */
const distanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

interface LiveLensProps {
  onCapture: (snap: Snapshot) => void;
  onEndSession: (summary: string) => void;
  /** Leave without review; `note` is a quiet line to show afterwards (e.g. the Lens rested). */
  onExit: (note?: string) => void;
  /** True while a recording is running, so the app can finish it before a back gesture leaves */
  onBusyChange?: (busy: boolean) => void;
  config: GeminiConfig;
  userMode: UserMode;
  audioContext: AudioContext | null;
  isFirstTime?: boolean;
  isFinalizing?: boolean;
  geminiServiceRef: React.MutableRefObject<GeminiLiveService | null>;
  updateSnapshot: (id: string, updates: Partial<Snapshot>) => void;
  pendingSnapshotIdRef: React.MutableRefObject<string | null>;
  initialAudioMode?: AudioMode;
  selectedMode?: 'observation' | 'conversation';
  /** Species already on the explorer's life list (common names). Fetched here when not given. */
  knownSpecies?: string[];
  /** Leaves the Lens and opens the camera-roll import (offered in the ⋯ menu before any capture). */
  onImportFromRoll?: () => void;
}

/** The explorer's choice of guide, remembered across visits (the same key App reads). */
export const LENS_MODE_KEY = 'naturegram_lens_mode';
const FIRST_LINE_KEY = 'naturegram_has_seen_tour';

type AgentState = 'BOOTING' | 'IDLE' | 'HEARING_USER' | 'THINKING' | 'SPEAKING' | 'DISCONNECTED' | 'RECONNECTING' | 'FINALIZING';

/** The sighting as a specimen tag: common name, scientific name, one line, and any stamp it earned. */
export const SightingTag: React.FC<{ card: SightingCard; reduceMotion: boolean; onClose: () => void }> = ({ card, reduceMotion, onClose }) => (
  <motion.div
      key={card.id}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
      className="absolute bottom-40 inset-x-0 mx-auto w-[calc(100%-3rem)] max-w-sm z-[85] pointer-events-auto"
  >
      {/* The sighting, as the landing names things: a fine rule, then the name in white serif italic */}
      <div className="relative bg-black/55 backdrop-blur-xl text-white rounded-2xl pl-6 pr-12 py-5">
          <div role="status" aria-live="polite" aria-atomic="true">
              <span className="block w-8 h-px bg-theme-vivid mb-3" aria-hidden="true" />
              <p className="text-sm text-white/75 mb-0.5"><span className="sr-only">Your guide, an AI: </span>{confidenceLead(card.confidence)}</p>
              <p className="ng-dark-title">{card.name}</p>
              {card.scientific && <p className="font-display italic text-base text-white/70 mt-0.5">{card.scientific}</p>}
              {card.line && <p className="ng-dark-caption text-white/85 mt-2">{card.line}</p>}
              {card.safety && (
                  <p className="mt-3 flex gap-2 text-sm leading-snug text-red-100 border-l-2 border-red-300 pl-3">
                      <Glyph name="alert" size={16} className="shrink-0 mt-0.5 text-red-300" />
                      <span>{card.safety}</span>
                  </p>
              )}
              {card.firstForList && <span className="sr-only">First for your list.</span>}
          </div>
          <button
              onClick={onClose}
              aria-label="Put this sighting away"
              className="absolute top-2 right-2 ng-icon-button-dark text-white/80"
          >
              <Glyph name="close" size={20} />
          </button>
          {card.firstForList && (
              <motion.div
                  className="absolute -top-[3.75rem] right-12"
                  initial={{ opacity: 0, rotate: 8 }}
                  animate={{ opacity: 1, rotate: 8 }}
                  transition={{ delay: reduceMotion ? 0 : 0.35, duration: 0.6 }}
                  aria-hidden="true"
              >
                  <PlateStamp>First for your list</PlateStamp>
              </motion.div>
          )}
      </div>
  </motion.div>
);

const LiveLens: React.FC<LiveLensProps> = ({ onCapture, onEndSession, onExit, config, userMode, audioContext, isFirstTime, isFinalizing, geminiServiceRef, updateSnapshot, pendingSnapshotIdRef, initialAudioMode = 'voice', selectedMode: initialMode = 'observation', knownSpecies, onImportFromRoll, onBusyChange }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isCameraActive, setIsCameraActive] = useState(true);
  const isCameraActiveRef = useRef(true);

  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const facingModeRef = useRef(facingMode);
  facingModeRef.current = facingMode;
  const [pan, setPan] = useState(0);
  const [tilt, setTilt] = useState(0);

  const [zoomRange, setZoomRange] = useState({ min: 1, max: 8, step: 0.1 });
  const [panRange, setPanRange] = useState({ min: 0, max: 0, step: 1 });
  const [tiltRange, setTiltRange] = useState({ min: 0, max: 0, step: 1 });

  const [hasTorch, setHasTorch] = useState(false);
  const [canZoom, setCanZoom] = useState(false);
  const [canPan, setCanPan] = useState(false);
  const [canTilt, setCanTilt] = useState(false);

  const [aiOpticActive, setAiOpticActive] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);

  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const capabilitiesRef = useRef<any>({});
  const supportedConstraintsRef = useRef<MediaTrackSupportedConstraints>({});

  const [agentState, setAgentState] = useState<AgentState>('BOOTING');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [liveCaption, setLiveCaption] = useState("");
  // The Lens no longer holds a tour back: the session starts at once and the first visit gets one line
  const isTourActive = false;
  const [firstLine, setFirstLine] = useState<boolean>(() => {
    try { return !localStorage.getItem(FIRST_LINE_KEY); } catch { return false; }
  });
  const dismissFirstLine = useCallback(() => {
    setFirstLine(false);
    try { localStorage.setItem(FIRST_LINE_KEY, 'true'); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    if (!firstLine) return;
    const t = window.setTimeout(dismissFirstLine, 12000);
    return () => clearTimeout(t);
  }, [firstLine, dismissFirstLine]);
  /** A brief note on screen: something the guide did or suggests (it never acts unseen). */
  const [guideNote, setGuideNote] = useState<string | null>(null);
  const guideNoteTimerRef = useRef<number | null>(null);
  const showGuideNote = useCallback((text: string, ms = 4500) => {
    setGuideNote(text);
    if (guideNoteTimerRef.current) clearTimeout(guideNoteTimerRef.current);
    guideNoteTimerRef.current = window.setTimeout(() => setGuideNote(n => (n === text ? null : n)), ms);
  }, []);
  useEffect(() => () => { if (guideNoteTimerRef.current) clearTimeout(guideNoteTimerRef.current); }, []);
  // Quiet companion by default; "Talk with me" switches to the talkative guide (and restarts the session)
  const [selectedMode, setSelectedMode] = useState<'observation' | 'conversation'>(initialMode);
  // Quiet watching (waiting for a bird) needs time; the live guide costs live minutes, so it rests sooner
  const IDLE_LIMIT_MS = selectedMode === 'observation' ? 180_000 : 60_000;
  // Live time is billed: however lively the sound around the phone (a pocket, a street), a conversation
  // asks "Still with me?" after five minutes without a touch, so a forgotten Lens can't run on
  const HANDS_FREE_MAX_MS = 5 * 60_000;
  /** When the explorer last spoke (voice heard on the microphone), for the guide's idle clock */
  const lastVoiceRef = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const { close: closeMenu } = useBackToClose(menuOpen, () => setMenuOpen(false));
  const [captureCount, setCaptureCount] = useState(0);
  const captureCountRef = useRef(0);
  captureCountRef.current = captureCount;

  const [audioMode, setAudioMode] = useState<AudioMode>(initialAudioMode);
  const [hasSelectedMode, setHasSelectedMode] = useState(true);
  const [pendingAnalyses, setPendingAnalyses] = useState(0);
  // Session limits: the conversation runs until today's live minutes are used (the server enforces
  // the same daily allowance for everyone); idle timeout; capture cap in observation mode.
  const CONVERSATION_FALLBACK_MS = 60_000;
  const OBSERVATION_MAX_CAPTURES = 3;
  const CAP_MESSAGE = `This quiet session holds ${OBSERVATION_MAX_CAPTURES} captures. Tap Done to write them up, then open the Lens again.`;
  const conversationEndsAtRef = useRef<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [idleWarning, setIdleWarning] = useState<number | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());
  const isProcessingCapture = pendingAnalyses > 0;
  const [showTranscript, setShowTranscript] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<{type: 'success' | 'error' | 'processing', text: string} | null>(null);
  // The sighting card rests until the next capture or until the explorer puts it away (no countdown)
  const [latestSighting, setLatestSighting] = useState<SightingCard | null>(null);
  const reduceMotion = useReducedMotion();

  // Life-list awareness: which species the explorer already has, so a first can be marked as one
  const [lifeNames, setLifeNames] = useState<string[] | null>(knownSpecies ?? null);
  const sessionNamesRef = useRef<string[]>([]);
  useEffect(() => {
    if (knownSpecies) { setLifeNames(knownSpecies); return; }
    if (userMode.isAnonymous || FirebaseService.isCurrentUserAnonymous()) return;
    let alive = true;
    FirebaseService.getMySpeciesSet().then(set => { if (alive) setLifeNames(Array.from(set)); }).catch(() => {});
    return () => { alive = false; };
  }, [knownSpecies, userMode.isAnonymous, userMode.userId]);

  // What this outing gathered, for the closing beat: thumbnails, names and the place
  const sessionCapturesRef = useRef<Map<string, { thumb?: string; name?: string; type: string }>>(new Map());
  const placeRef = useRef<string>('');
  const [closing, setClosing] = useState<{ items: { thumb?: string; name?: string; type: string }[]; minutes: number; place: string } | null>(null);

  const showStatus = useCallback((type: 'success' | 'error' | 'processing', text: string, ms = 5000) => {
      setAnalysisStatus({ type, text });
      if (type !== 'processing') {
          setTimeout(() => {
              setAnalysisStatus(current => {
                 if (current?.text === text && current?.type === type) return null;
                 return current;
              });
          }, ms);
      }
  }, []);
  /** A full-screen problem; `roll` offers the camera roll instead (no camera on this device). */
  const [sessionError, setSessionError] = useState<{ title: string; message: string; action?: 'roll' } | null>(null);

  // Handlers below are memoised with narrow deps, so they read live values through refs
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  const lifeNamesRef = useRef(lifeNames);
  lifeNamesRef.current = lifeNames;
  const audioModeRef = useRef(audioMode);
  audioModeRef.current = audioMode;
  const audioContextRef = useRef(audioContext);
  audioContextRef.current = audioContext;

  /** Every capture goes through here: the last card steps aside and the outing remembers the capture. */
  const recordCapture = useCallback((snap: Snapshot) => {
      setLatestSighting(null);
      setCaptureCount(n => n + 1);
      sessionCapturesRef.current.set(snap.id, { thumb: snap.url || snap.associatedImages?.[0]?.url, type: snap.type, name: UNNAMED.test(snap.labels?.[0] || '') ? undefined : snap.labels?.[0] });
      onCaptureRef.current(snap);
  }, []);

  /** A soft two-note chime for a first on the list. Quiet, short, and never when sound is off. */
  const playChime = useCallback(() => {
      const ctx = audioContextRef.current;
      if (!ctx || audioModeRef.current === 'silent' || ctx.state !== 'running') return;
      try {
          const t = ctx.currentTime;
          [[784, 0], [1175, 0.12]].forEach(([f, d]) => {
              const o = ctx.createOscillator(); const g = ctx.createGain();
              o.type = 'sine'; o.frequency.value = f;
              g.gain.setValueAtTime(0, t + d);
              g.gain.linearRampToValueAtTime(0.05, t + d + 0.02);
              g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.45);
              o.connect(g); g.connect(ctx.destination);
              o.start(t + d); o.stop(t + d + 0.5);
          });
      } catch { /* a missing chime never matters */ }
  }, []);

  /** Present an identified sighting as a specimen tag; returns the toast line in the guide's voice. */
  const presentSighting = useCallback((snapId: string, s: { labels?: string[]; behavior?: string; aiInsight?: string; aiIdentifications?: any[] | null; aiFlags?: any; location?: string; confidence?: 'high' | 'medium' | 'low' | null; safetyNote?: string }): string => {
      if (s.location) placeRef.current = s.location;
      const name = (s.labels?.[0] || '').trim();
      if (!name || UNNAMED.test(name)) return 'Captured. You can name it in review.';
      const entry = sessionCapturesRef.current.get(snapId);
      if (entry) entry.name = name;
      const sciCandidate = [s.labels?.[1], s.aiIdentifications?.[0]?.scientificName].find(x => !!x && /^[A-Z][a-z]+ [a-z]+/.test(x));
      const known = lifeNamesRef.current;
      const seen = [...(known || []), ...sessionNamesRef.current].map(n => ({ name: n }));
      // A first is stamped (and chimed) only when the guide is fairly sure or better
      const sureEnough = s.confidence === 'high' || s.confidence === 'medium';
      const firstForList = sureEnough && !!known && !isOnList(seen, name);
      const safety = (s.safetyNote || '').trim()
          || (s.aiFlags?.fungi ? 'Never eat or handle wild fungi based on this name.' : s.aiFlags?.dangerous ? 'This may be dangerous. Keep your distance.' : '');
      if (!isOnList(sessionNamesRef.current.map(n => ({ name: n })), name)) sessionNamesRef.current.push(name);
      const theme = getDailyThemeConst();
      const challenge = answersChallenge(theme.id, s) ? theme.naturalist : null;
      setLatestSighting({
          id: snapId, name, scientific: sciCandidate && sciCandidate.toLowerCase() !== name.toLowerCase() ? sciCandidate : undefined,
          line: oneSentence(s.behavior) || oneSentence(s.aiInsight), firstForList, challenge,
          confidence: s.confidence ?? null, safety: safety || undefined,
      });
      if (firstForList) {
          try { navigator.vibrate?.([12, 40, 12]); } catch { /* unsupported */ }
          playChime();
      }
      if (s.confidence === 'high') return `${name}, captured.`;
      if (s.confidence === 'medium') return `Could be ${name}. Captured.`;
      return `Captured. Not sure: maybe ${name}.`;
  }, [playChime]);

  const updateSnapshotRef = useRef(updateSnapshot);
  updateSnapshotRef.current = updateSnapshot;
  /** Captures whose identification failed because the phone was offline; named again when it's back */
  const offlineQueueRef = useRef<Map<string, IdJob>>(new Map());

  /**
   * Every capture is identified here, in the background: the result lands on the capture and as a
   * tag on screen. Offline failures wait for the connection to come back while the Lens is open.
   */
  const identifyCapture = useCallback((snapId: string, job: IdJob) => {
      setPendingAnalyses(n => n + 1);
      const t0 = performance.now();
      const run = job.multimodal
          ? GenAiService.analyzeMultimodal(job.media, job.images, job.location)
          : GenAiService.analyzeMedia(job.media!, job.mediaType, job.location);
      run.then(result => {
          track('ai_result', { ok: true, type: job.trackType, ms: Math.round(performance.now() - t0), confidence: result.confidence });
          updateSnapshotRef.current(snapId, {
              aiInsight: result.ecologic,
              labels: result.taxonomy,
              ...(result.location ? { locationArea: result.location } : {}),
              isAnalyzing: false,
              aiProposedLabels: result.taxonomy,
              aiProposedBehavior: result.ecologic,
              aiConfidence: result.confidence,
              aiIdentifications: result.identifications,
              aiFlags: result.flags,
              needsExpertReview: result.needsExpertReview,
              aiSafetyNote: result.safetyNote,
              aiModel: result.model,
              aiPromptVersion: result.promptVersion,
              aiResultId: result.resultId,
              aiError: null
          });
          setPendingAnalyses(n => Math.max(0, n - 1));
          showStatus('success', presentSighting(snapId, { labels: result.taxonomy, aiInsight: result.ecologic, aiIdentifications: result.identifications, aiFlags: result.flags, location: result.location, confidence: result.confidence, safetyNote: result.safetyNote }));
      }).catch(err => {
          console.error("Background analysis failed", err);
          setPendingAnalyses(n => Math.max(0, n - 1));
          const offline = err?.kind === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false);
          if (offline) {
              offlineQueueRef.current.set(snapId, job);
              updateSnapshotRef.current(snapId, { aiInsight: "", labels: [], isAnalyzing: false, aiError: "You were offline, so your guide couldn't look" });
              showStatus('error', "You're offline. Your guide names it when you're back online, or you can name it yourself.", 7000);
              return;
          }
          updateSnapshotRef.current(snapId, { aiInsight: "", labels: [], isAnalyzing: false, aiError: err?.message || "Identification unavailable right now" });
          showStatus('error', err?.kind === 'quota' ? err.message : "Couldn't identify this one. You can name it yourself in review.");
      });
  }, [presentSighting, showStatus]);

  // Back online: the captures that failed while offline are looked at again
  useEffect(() => {
      const back = () => {
          const queued = Array.from(offlineQueueRef.current.entries());
          offlineQueueRef.current.clear();
          if (!queued.length) return;
          showStatus('processing', queued.length === 1 ? "You're back online. Your guide is looking at your capture…" : `You're back online. Your guide is looking at ${queued.length} captures…`);
          queued.forEach(([id, job]) => { updateSnapshotRef.current(id, { isAnalyzing: true, aiError: null }); identifyCapture(id, job); });
      };
      window.addEventListener('online', back);
      return () => window.removeEventListener('online', back);
  }, [identifyCapture, showStatus]);

  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  /** Exact position (kept only in the private rawLocation) and the town it's near, when known. */
  const lastLocationRef = useRef<{ lat: number; lng: number; name?: string } | null>(null);
  /** The town name for the AI and the review; never coordinates. */
  const placeName = () => lastLocationRef.current?.name || undefined;
  const locationWatchIdRef = useRef<number | null>(null);

  const [naturalistId, setNaturalistId] = useState("");

  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [lastAudioSnapshotId, setLastAudioSnapshotId] = useState<string | null>(null);
  const [lastAudioImages, setLastAudioImages] = useState<{url: string, blob: Blob}[]>([]);
  const pendingAssociatedImagesRef = useRef<{ url: string, blob: Blob }[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const micHoldTimeoutRef = useRef<number | null>(null);

  // Audio routing nodes
  const agentGainNodeRef = useRef<GainNode | null>(null);
  const recordingGainNodeRef = useRef<GainNode | null>(null);
  const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const sessionStartMsRef = useRef<number>(Date.now());
  const retakesCountRef = useRef<number>(0);
  const rawLocationRef = useRef<{lat: number, lng: number} | null>(null);

  const captureFrame = useCallback((optimize: boolean = false): { dataUrl: string, blobPromise?: Promise<Blob> } | null => {
    if (!videoRef.current || !canvasRef.current || !isCameraActiveRef.current) return null;
    const canvas = canvasRef.current;
    if (videoRef.current.videoWidth > 0) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
    }
    if (canvas.width === 0) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', optimize ? 0.95 : 0.5);

    if (optimize) {
        setIsFlashing(true);
        setTimeout(() => setIsFlashing(false), 150);
    }

    return {
        dataUrl,
        blobPromise: optimize ? compressImageToBlob(dataUrl, 1600, 0.85) : undefined
    };
  }, []);

  const startRecording = useCallback((type: 'audio' | 'video') => {
    if (!activeStreamRef.current) return;

    let streamToRecord: MediaStream;
    if (type === 'audio') {
        if (recordingDestinationRef.current) {
            streamToRecord = recordingDestinationRef.current.stream;
        } else {
            const audioTrack = activeStreamRef.current.getAudioTracks()[0];
            if (!audioTrack) return;
            streamToRecord = new MediaStream([audioTrack]);
        }
    } else {
        if (recordingDestinationRef.current) {
            const videoTracks = activeStreamRef.current.getVideoTracks();
            streamToRecord = new MediaStream([...videoTracks, ...recordingDestinationRef.current.stream.getAudioTracks()]);
        } else {
            streamToRecord = activeStreamRef.current;
        }
    }

    // Prefer MP4/H.264 + AAC (plays everywhere incl. iPhone); fall back to WebM where MP4 recording isn't supported
    const candidates = type === 'video'
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      : ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = candidates.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m));
    const recorder = mimeType ? new MediaRecorder(streamToRecord, { mimeType }) : new MediaRecorder(streamToRecord);
    mediaRecorderRef.current = recorder;
    mediaChunksRef.current = [];
    pendingAssociatedImagesRef.current = [];
    setLastAudioSnapshotId(null);
    setLastAudioImages([]);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) mediaChunksRef.current.push(e.data);
    };

    let settle: () => void = () => {};
    captureSettledRef.current = new Promise<void>(res => { settle = res; });
    recorder.onstop = () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      onBusyChange?.(false);
      if (discardRecordingRef.current) { settle(); return; } // the Lens closed underneath it
      const recordedType = (recorder.mimeType || (type === 'video' ? 'video/webm' : 'audio/webm')).split(';')[0];
      const mediaBlob = new Blob(mediaChunksRef.current, { type: recordedType });

      let dataUrl: string | undefined;
      let blobPromise: Promise<Blob> | undefined;

      if (isCameraActiveRef.current) {
         const res = captureFrame(true);
         if (res) {
             dataUrl = res.dataUrl;
             blobPromise = res.blobPromise;
         }
      }

      const finishCapture = (imgBlob?: Blob, imgUrl?: string) => {
          settle();
          const snapId = Date.now().toString();
          pendingSnapshotIdRef.current = snapId;
          showStatus('processing', 'Analysing your capture…');

          if (type === 'audio') {
              setLastAudioSnapshotId(snapId);
              setLastAudioImages(pendingAssociatedImagesRef.current.length > 0 ? pendingAssociatedImagesRef.current : []);
          }

          const isAudioOnly = type === 'audio' && !imgBlob;
          const prompt = isAudioOnly
            ? "I just captured an audio snippet. The system is analyzing it in the background. Please acknowledge this and wait for the results."
            : `I just captured ${type === 'audio' ? 'an audio recording' : `a ${type}`}. The system is analyzing it in the background. Please acknowledge this and wait for the results.`;

          const location = placeName();

          retakesCountRef.current += 1;

          recordCapture({
               id: snapId,
               url: imgUrl || '', // Might be empty if audio only
               blob: imgBlob,
               audioBlob: type === 'audio' ? mediaBlob : undefined,
               videoBlob: type === 'video' ? mediaBlob : undefined,
               timestamp: new Date().toLocaleTimeString(),
               labels: [type === 'video' ? 'Video Recording' : 'Audio Recording'],
               behavior: `Captured ${type} snippet.`,
               aiInsight: "Processing...",
               type: type,
               userId: userMode.userId,
               isHybrid: (!!imgBlob && type === 'audio') || pendingAssociatedImagesRef.current.length > 0,
               associatedImages: pendingAssociatedImagesRef.current.length > 0 ? pendingAssociatedImagesRef.current : undefined,
               location: location,
               isAnalyzing: true,
               rawLocation: lastLocationRef.current ? { lat: lastLocationRef.current.lat, lng: lastLocationRef.current.lng } : null,
               timeToRecordMs: Date.now() - sessionStartMsRef.current,
               sessionRetakes: retakesCountRef.current
          });
          geminiServiceRef.current?.sendText(prompt);

          // Trigger background high-fidelity multimodal analysis
          const associatedBlobs = pendingAssociatedImagesRef.current.map(i => i.blob);
          const allImageBlobs = imgBlob ? [imgBlob, ...associatedBlobs] : associatedBlobs;

          track('capture', { type, keyframes: allImageBlobs.length });
          identifyCapture(snapId, { multimodal: true, media: mediaBlob, images: allImageBlobs, mediaType: type, location, trackType: type });
      };

      if (blobPromise) {
          blobPromise.then(compressedBlob => {
              finishCapture(compressedBlob, URL.createObjectURL(compressedBlob));
          }).catch(() => finishCapture());
      } else {
          finishCapture();
      }

      setIsRecordingAudio(false);
      setIsRecordingVideo(false);
      setRecordingTime(0);
    };

    recorder.start();
    onBusyChange?.(true);
    if (type === 'audio') setIsRecordingAudio(true);
    if (type === 'video') setIsRecordingVideo(true);
    setRecordingTime(30);

    // Notify agent of manual recording start
    if (geminiServiceRef.current?.isConnected()) {
        geminiServiceRef.current.sendText(`[SYSTEM: Started recording ${type}]`);
    }

    recordingIntervalRef.current = window.setInterval(() => {
      setRecordingTime(prev => {
        if (prev <= 1) {
          recorder.stop();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [onCapture, userMode.userId, captureFrame, onBusyChange, identifyCapture]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleShutterPress = useCallback(() => {
      if (selectedMode === 'observation' && retakesCountRef.current >= OBSERVATION_MAX_CAPTURES && !isRecordingVideo) {
          showStatus('error', CAP_MESSAGE, 7000);
          return;
      }
      if (!isCameraActive) {
          setIsCameraActive(true);
          return;
      }

      holdTimeoutRef.current = window.setTimeout(() => {
          holdTimeoutRef.current = null;
          startRecording('video');
      }, 500); // 500ms hold to start video
  }, [isCameraActive, startRecording]);

  const handleShutterRelease = useCallback(() => {
      let wasHold = false;
      if (holdTimeoutRef.current) {
          clearTimeout(holdTimeoutRef.current);
          holdTimeoutRef.current = null;
      } else {
          wasHold = true;
      }

      if (isRecordingVideo && wasHold) {
          stopRecording();
      } else if (isCameraActive && !wasHold) {
          // It was a tap, take a photo
          const res = captureFrame(true);
          if (res && res.blobPromise) {
              res.blobPromise.then(compressedBlob => {
                  const objUrl = URL.createObjectURL(compressedBlob);

                  if (isRecordingVideo || isRecordingAudio) {
                      // Associate with ongoing recording
                      pendingAssociatedImagesRef.current.push({ url: objUrl, blob: compressedBlob });
                      // Visual feedback
                      setIsFlashing(true);
                      setTimeout(() => setIsFlashing(false), 150);
                      // Notify agent
                      geminiServiceRef.current?.sendText(`[SYSTEM: Captured key frame during ${isRecordingVideo ? 'video' : 'audio'} recording]`);
                      return;
                  }

                  if (lastAudioSnapshotId) {
                      // Associate with the last audio recording
                      setIsFlashing(true);
                      setTimeout(() => setIsFlashing(false), 150);
                      const newImages = [...lastAudioImages, { url: objUrl, blob: compressedBlob }];
                      setLastAudioImages(newImages);
                      updateSnapshot(lastAudioSnapshotId, {
                          associatedImages: newImages,
                          isHybrid: true
                      });
                      geminiServiceRef.current?.sendText(`[SYSTEM: Captured an image to associate with the previous audio recording]`);
                      setLastAudioSnapshotId(null); // Clear after one photo
                      return;
                  }

                  const snapId = Date.now().toString();
                  pendingSnapshotIdRef.current = snapId;
                  showStatus('processing', 'Analysing your photo…');
                  const location = placeName();

                  retakesCountRef.current += 1;

                  recordCapture({
                      id: snapId,
                      url: objUrl,
                      blob: compressedBlob,
                      timestamp: new Date().toLocaleTimeString(),
                      labels: ['Manual Observation'],
                      behavior: "Captured photo.",
                      aiInsight: "Processing...",
                      type: 'image',
                      userId: userMode.userId,
                      isHybrid: false,
                      location: location,
                      isAnalyzing: true,
                      rawLocation: lastLocationRef.current ? { lat: lastLocationRef.current.lat, lng: lastLocationRef.current.lng } : null,
                      timeToRecordMs: Date.now() - sessionStartMsRef.current,
                      sessionRetakes: retakesCountRef.current
                  });

                  track('capture', { type: 'photo' });
                  identifyCapture(snapId, { multimodal: false, media: compressedBlob, images: [], mediaType: 'image', location, trackType: 'photo' });
              });
          }
      }
  }, [isCameraActive, isRecordingVideo, isRecordingAudio, stopRecording, captureFrame, onCapture, userMode.userId, lastAudioSnapshotId, lastAudioImages, updateSnapshot, identifyCapture]);

  useEffect(() => {
    if (agentGainNodeRef.current && audioContext) {
      agentGainNodeRef.current.gain.setTargetAtTime(isMuted ? 0 : 1, audioContext.currentTime, 0.05);
    }
  }, [isMuted, audioContext]);

  /** A clip without holding: Shift+Enter on the shutter, or "Start a clip" in the ⋯ menu (keyboards, switches). */
  const toggleClip = useCallback(() => {
    if (isRecordingVideo) { stopRecording(); return; }
    if (isRecordingAudio) return;
    if (selectedMode === 'observation' && retakesCountRef.current >= OBSERVATION_MAX_CAPTURES) { showStatus('error', CAP_MESSAGE, 7000); return; }
    if (!isCameraActive) { setIsCameraActive(true); return; }
    startRecording('video');
  }, [isRecordingVideo, isRecordingAudio, isCameraActive, selectedMode, startRecording, stopRecording, showStatus]);

  /** Sound recording: one tap to start, one tap to stop (max 30 s). */
  const toggleSoundRecording = useCallback(() => {
    if (isRecordingVideo) return;
    if (!isRecordingAudio && selectedMode === 'observation' && retakesCountRef.current >= OBSERVATION_MAX_CAPTURES) {
        showStatus('error', CAP_MESSAGE, 7000);
        return;
    }
    if (isRecordingAudio) stopRecording();
    else startRecording('audio');
  }, [isRecordingAudio, isRecordingVideo, startRecording, stopRecording, selectedMode, showStatus]);

  /** A photo, clip or sound from the camera roll, added to this session (the ⋯ menu after the first capture). */
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isAudio && !isImage) { showStatus('error', "That isn't a photo, video or sound."); return; }
      if (selectedMode === 'observation' && retakesCountRef.current >= OBSERVATION_MAX_CAPTURES) { showStatus('error', CAP_MESSAGE, 7000); return; }
      // A photo that can't be redrawn would keep its hidden location: never added
      if (isImage && !(await canCleanImage(file))) { showStatus('error', UNCLEANABLE_IMAGE_MESSAGE, 7000); return; }

      if (isVideo || isAudio) {
          const media = isVideo ? document.createElement('video') : document.createElement('audio');
          media.src = URL.createObjectURL(file);

          await new Promise((resolve) => {
              media.onloadedmetadata = resolve;
              media.onerror = resolve;
          });

          if (media.duration > 30) {
              showStatus('error', 'Please choose a clip of 30 seconds or less.');
              URL.revokeObjectURL(media.src);
              return;
          }
      }

      const snapId = Date.now().toString();
      const location = placeName();
      const mediaType = isVideo ? 'video' : (isAudio ? 'audio' : 'image');
      const tooLarge = tooLargeToAnalyse([file]);
      showStatus(tooLarge ? 'error' : 'processing', tooLarge ? 'Added. It is too large for your guide to look at, so name it yourself in review.' : 'Analysing your upload…', 7000);

      if (isImage) {
          retakesCountRef.current += 1;
          recordCapture({
              id: snapId,
              url: URL.createObjectURL(file),
              blob: file,
              timestamp: new Date().toLocaleTimeString(),
              labels: ['Uploaded Discovery'],
              behavior: "Uploaded media.",
              aiInsight: "Processing...",
              type: 'image',
              userId: userMode.userId,
              isHybrid: false,
              location: location,
              isAnalyzing: !tooLarge,
              rawLocation: lastLocationRef.current ? { lat: lastLocationRef.current.lat, lng: lastLocationRef.current.lng } : null,
              timeToRecordMs: Date.now() - sessionStartMsRef.current,
              sessionRetakes: retakesCountRef.current
          });
          const reader = new FileReader();
          reader.onload = () => {
              if (reader.result) {
                   geminiServiceRef.current?.sendVideoFrame(reader.result as string);
              }
          };
          reader.readAsDataURL(file);
      } else {
          retakesCountRef.current += 1;
          recordCapture({
              id: snapId,
              videoUrl: isVideo ? URL.createObjectURL(file) : undefined,
              videoBlob: isVideo ? file : undefined,
              audioUrl: isAudio ? URL.createObjectURL(file) : undefined,
              audioBlob: isAudio ? file : undefined,
              timestamp: new Date().toLocaleTimeString(),
              labels: ['Uploaded Discovery'],
              behavior: "Uploaded media.",
              aiInsight: "Processing...",
              type: mediaType,
              userId: userMode.userId,
              isHybrid: false,
              location: location,
              isAnalyzing: !tooLarge,
              rawLocation: lastLocationRef.current ? { lat: lastLocationRef.current.lat, lng: lastLocationRef.current.lng } : null,
              timeToRecordMs: Date.now() - sessionStartMsRef.current,
              sessionRetakes: retakesCountRef.current
          });
      }

      track('capture', { type: `upload_${mediaType}` });
      if (tooLarge) { updateSnapshot(snapId, { aiInsight: '', labels: [], isAnalyzing: false }); return; }
      identifyCapture(snapId, { multimodal: false, media: file, images: [], mediaType, location, trackType: `upload_${mediaType}` });
  };

  const getStatusText = () => {
    if (agentState === 'FINALIZING') return "Wrapping up…";
    // The quiet Lens has no live guide: nothing is listening or watching, captures are named afterwards
    if (selectedMode === 'observation') return agentState === 'DISCONNECTED' ? "Lens paused · tap to retry" : "Quiet Lens · your guide names captures afterwards";
    if (agentState === 'RECONNECTING') return "Reconnecting…";
    switch (agentState) {
        case 'BOOTING': return "Waking your guide…";
        case 'IDLE': return isCameraActive ? "Guide is watching" : "Guide is listening";
        case 'HEARING_USER': return isMuted ? "Guide can't hear you (muted)" : "Guide is listening";
        case 'THINKING': return "Guide is thinking…";
        case 'SPEAKING': return "Guide is speaking";
        case 'DISCONNECTED': return "Guide offline · tap to retry";
        default: return "Guide ready";
    }
  };

  /** The status pill's mark: the guide's breathing dot while it waits or works, a plain icon otherwise. */
  const getPebbleStyle = (): { icon: string; guide?: 'breathe' | 'still' } => {
    if (selectedMode === 'observation' && agentState !== 'FINALIZING' && agentState !== 'DISCONNECTED') return { icon: 'visibility' };
    if (agentState === 'FINALIZING' || agentState === 'RECONNECTING' || agentState === 'BOOTING' || agentState === 'THINKING') return { icon: 'guide', guide: 'breathe' };
    if (agentState === 'DISCONNECTED') return { icon: 'guide', guide: 'still' };
    if (agentState === 'HEARING_USER') return { icon: isMuted ? 'mic_off' : 'mic' };
    if (agentState === 'SPEAKING') return { icon: isCameraActive ? 'record_voice_over' : 'volume_up' };
    if (isCameraActive) return { icon: 'visibility' };
    return { icon: isMuted ? 'mic_off' : 'mic_none' };
  };

  const finalizingRef = useRef(false);
  const countedConversationRef = useRef(false);
  /** Resolves once the clip being recorded has been stopped and handed over as a capture. */
  const captureSettledRef = useRef<Promise<void>>(Promise.resolve());

  const finalizeSession = useCallback(async (summary?: string, opts: { quiet?: boolean } = {}) => {
    // Idle, background, Done and the guide can all ask at once: end only once
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setAgentState('FINALIZING');
    setIdleWarning(null);
    // A clip being recorded is finished and kept first, never dropped
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === 'recording') {
      await new Promise<void>(res => { rec.addEventListener('stop', () => setTimeout(res, 0), { once: true }); try { rec.stop(); } catch { res(); } });
      await Promise.race([captureSettledRef.current, new Promise(r => setTimeout(r, 4000))]);
    }
    // Nothing gathered: no empty review, back to where the explorer was with a quiet word
    if (sessionCapturesRef.current.size === 0 && captureCountRef.current === 0) {
      stopAllAudioRef.current();
      onExit(opts.quiet ? undefined : summary);
      return;
    }
    const startedAt = Date.now();
    // The closing beat: what the outing gathered, pinned like specimens, while the session wraps up
    const items = Array.from(sessionCapturesRef.current.values());
    setClosing({ items, minutes: Math.max(1, Math.round((startedAt - sessionStartMsRef.current) / 60_000)), place: placeRef.current });
    const finalSummary = summary || "We closed the notebook on a good walk. Your captures are waiting for you to write them up.";
    if (naturalistId) {
      try {
        await FirebaseService.updateNaturalistMemory(naturalistId, { lastSessionSummary: finalSummary });
      } catch (e) {
        console.warn("Failed to update naturalist memory, proceeding to end session anyway:", e);
      }
    }
    // Long enough to see the page close (about 2.5 s with captures), never longer than that
    const beat = items.length ? 2500 : 1200;
    setTimeout(() => onEndSession(finalSummary), Math.max(300, beat - (Date.now() - startedAt)));
  }, [naturalistId, onEndSession, onExit]);

  useEffect(() => { if (isFinalizing && agentState !== 'FINALIZING') finalizeSession(); }, [isFinalizing, agentState, finalizeSession]);

  useEffect(() => {
      const ping = setInterval(() => RateLimitService.pingSessionActive(), 5000);
      RateLimitService.pingSessionActive();
      return () => { clearInterval(ping); RateLimitService.clearSessionActive(); };
  }, []);

  /** When the quiet Lens went to the background (it may wait there a minute), or null */
  const hiddenAtRef = useRef<number | null>(null);
  /** Since when the live guide has been trying to connect (it falls back to the quiet Lens after 20 s) */
  const liveWaitSinceRef = useRef<number | null>(null);
  const liveErrorRef = useRef<any>(null);
  const fallBackRef = useRef<(reason: string) => void>(() => {});

  useEffect(() => {
      const touch = () => { lastInteractionRef.current = Date.now(); setIdleWarning(null); };
      const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
      events.forEach(ev => window.addEventListener(ev, touch, { passive: true }));
      const tick = setInterval(() => {
          if (agentState === 'FINALIZING') return;
          const now = Date.now();
          // In the background the idle clock stands still; only the background minute counts
          if (hiddenAtRef.current !== null) {
              if (now - hiddenAtRef.current >= BACKGROUND_GRACE_MS) finalizeSession('The Lens closed after a minute in the background.');
              return;
          }
          // A live guide that can't connect gives way to the quiet Lens instead of "Reconnecting…" for ever
          if (selectedMode === 'conversation' && liveWaitSinceRef.current && now - liveWaitSinceRef.current > 20_000) {
              fallBackRef.current(liveFailureReason(liveErrorRef.current));
              return;
          }
          // A clip being recorded is someone at work; it is capped at 30 seconds anyway
          if (isRecordingAudio || isRecordingVideo) lastInteractionRef.current = now;
          let left: number;
          if (selectedMode === 'conversation') {
              // Talking to the guide counts as being there, and the guide finishing a sentence pauses the
              // clock; the guide's own voice never keeps a session alive, and nor does sound for ever
              if (agentState === 'SPEAKING') lastVoiceRef.current = Math.max(lastVoiceRef.current, now - 1);
              const quiet = now - Math.max(lastInteractionRef.current, lastVoiceRef.current);
              const untouched = now - lastInteractionRef.current;
              left = Math.min(IDLE_LIMIT_MS - quiet, HANDS_FREE_MAX_MS - untouched);
          } else {
              left = IDLE_LIMIT_MS - (now - lastInteractionRef.current);
          }
          if (left <= 0) finalizeSession(selectedMode === 'observation' ? 'The Lens rested after a few quiet minutes.' : 'The guide rested to save your live time.');
          else if (left <= 10_000) setIdleWarning(Math.ceil(left / 1000));
          if (conversationEndsAtRef.current && selectedMode === 'conversation') {
              const left = Math.max(0, Math.ceil((conversationEndsAtRef.current - Date.now()) / 1000));
              setSecondsLeft(left);
              if (left === 0) finalizeSession("That's today's live time. Captures still work, and live time resets at midnight UTC.");
          }
      }, 1000);
      return () => {
          events.forEach(ev => window.removeEventListener(ev, touch));
          clearInterval(tick);
      };
  }, [agentState, isRecordingAudio, isRecordingVideo, finalizeSession, IDLE_LIMIT_MS, selectedMode]);

  // Going to the background. "Talk with me" is billed by the second, so it ends at once. The quiet Lens
  // is free: it waits up to a minute (someone checking a message) with the camera paused, then resumes.
  useEffect(() => {
      const onVisibility = () => {
          if (finalizingRef.current) return;
          if (document.visibilityState === 'hidden') {
              if (selectedMode === 'conversation') { finalizeSession('The guide stopped when NatureGram went to the background, to save your live time.'); return; }
              if (hiddenAtRef.current === null) hiddenAtRef.current = Date.now();
              // A clip being recorded is finished and kept (its closing frame taken) before the camera pauses
              if (mediaRecorderRef.current?.state === 'recording') { try { mediaRecorderRef.current.stop(); } catch { /* already stopped */ } }
              Promise.race([captureSettledRef.current, new Promise(r => setTimeout(r, 3000))]).then(() => {
                  if (hiddenAtRef.current !== null) activeStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = false; });
              });
              return;
          }
          const hiddenAt = hiddenAtRef.current;
          if (hiddenAt === null) return;
          hiddenAtRef.current = null;
          // The phone may have frozen the page meanwhile: past the minute, it ends now
          if (Date.now() - hiddenAt >= BACKGROUND_GRACE_MS) { finalizeSession('The Lens closed after a minute in the background.'); return; }
          lastInteractionRef.current = Date.now();
          const track = videoTrackRef.current;
          if (track && track.readyState === 'ended') {
              startMediaStreamRef.current(facingModeRef.current).catch(() => showStatus('error', "The camera didn't come back. Close the Lens and open it again."));
          } else {
              activeStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isCameraActiveRef.current; });
          }
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => document.removeEventListener('visibilitychange', onVisibility);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMode, finalizeSession]);

  const addToChat = useCallback((role: 'user' | 'assistant' | 'system', text: string, links?: GroundingLink[]) => {
    setChatHistory(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === role && role !== 'system') {
             return prev.map((msg, i) => i === prev.length - 1 ? { ...msg, text: text, groundingLinks: links || msg.groundingLinks } : msg);
        }
        return [...prev, { id: Date.now().toString(), role, text, timestamp: new Date(), groundingLinks: links }];
    });
    if (role === 'assistant') { setLiveCaption(text); setAgentState('SPEAKING'); }
    else if (role === 'user') { setAgentState('HEARING_USER'); }
  }, []);

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    activeSourcesRef.current.clear();
    if (audioContext) nextStartTimeRef.current = audioContext.currentTime || 0;
    if (agentState !== 'RECONNECTING' && agentState !== 'FINALIZING') setAgentState('IDLE');
  }, [audioContext, agentState]);

  const stopAllAudioRef = useRef(stopAllAudio);
  stopAllAudioRef.current = stopAllAudio;
  const discardRecordingRef = useRef(false);

  // Leaving the Lens by any road: the guide's voice stops, a half-made recording is let go (the app
  // finishes recordings before a back gesture leaves, so this is only a last resort), timers end.
  useEffect(() => () => {
      activeSourcesRef.current.forEach(src => { try { src.stop(); } catch { /* already stopped */ } });
      activeSourcesRef.current.clear();
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      const rec = mediaRecorderRef.current;
      if (rec && rec.state === 'recording') { discardRecordingRef.current = true; try { rec.stop(); } catch { /* ignore */ } }
      onBusyChange?.(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen awake for the quiet Lens (watching is free; dimming would end it). A conversation
  // with the guide is billed, so there the phone may sleep as usual, which closes the session.
  useEffect(() => {
      if (selectedMode !== 'observation') return;
      let lock: any = null; let gone = false;
      const take = async () => {
          try { if (document.visibilityState === 'visible' && (navigator as any).wakeLock) { lock = await (navigator as any).wakeLock.request('screen'); if (gone) lock.release?.(); } } catch { /* not allowed: fine */ }
      };
      take();
      const again = () => { if (document.visibilityState === 'visible') take(); };
      document.addEventListener('visibilitychange', again);
      return () => { gone = true; document.removeEventListener('visibilitychange', again); try { lock?.release?.(); } catch { /* ignore */ } };
  }, [selectedMode]);

  const applyOpticalSettings = useCallback(async (settings: { zoom?: number, torch?: boolean, pan?: number, tilt?: number }) => {
    if (!videoTrackRef.current) return;
    try {
        const supported = supportedConstraintsRef.current;
        const advanced: any = {};

        if (settings.zoom !== undefined && (supported as any).zoom) {
            const clampedZoom = Math.max(zoomRange.min, Math.min(zoomRange.max, settings.zoom));
            advanced.zoom = clampedZoom;
            setZoom(clampedZoom);
        }

        if (settings.torch !== undefined && capabilitiesRef.current?.torch) {
            advanced.torch = settings.torch;
            setTorch(settings.torch);
        }

        if (settings.pan !== undefined && (supported as any).pan) {
            const clampedPan = Math.max(panRange.min, Math.min(panRange.max, settings.pan));
            advanced.pan = clampedPan;
            setPan(clampedPan);
        }

        if (settings.tilt !== undefined && (supported as any).tilt) {
            const clampedTilt = Math.max(tiltRange.min, Math.min(tiltRange.max, settings.tilt));
            advanced.tilt = clampedTilt;
            setTilt(clampedTilt);
        }

        if (Object.keys(advanced).length > 0) {
            await videoTrackRef.current.applyConstraints({ advanced: [advanced] } as any);
        }
    } catch (e) {
        console.warn("Optical failed", e);
    }
  }, [zoomRange, panRange, tiltRange]);

  const startMediaStream = useCallback(async (mode: 'user' | 'environment') => {
    if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(t => t.stop());
    }

    try {
        // Helper to try getting media with specific constraints
        const getMedia = async (c: MediaStreamConstraints) => {
            try {
                return await navigator.mediaDevices.getUserMedia(c);
            } catch (err: any) {
                // If permission is explicitly denied, do not retry - just throw to avoid spamming prompts or misleading errors
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') throw err;
                console.warn(`getUserMedia failed for constraints ${JSON.stringify(c)}:`, err);
                return null;
            }
        };

        // 1. Try preferred settings (Requested Mode + Audio Processing)
        // Note: Removed sampleRate constraint as it causes failures on some hardware.
        // Web Audio API will handle resampling later.
        let stream = await getMedia({
            video: { facingMode: mode },
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        // 2. Fallback: Any Camera + Audio Processing (Fixes desktop/device specific facingMode issues)
        if (!stream) {
            stream = await getMedia({
                video: true,
                audio: { echoCancellation: true, noiseSuppression: true }
            });
        }

        // 3. Fallback: Any Camera + Any Audio (Fixes audio constraint issues)
        if (!stream) {
            stream = await getMedia({ video: true, audio: true });
        }

        if (!stream) {
            throw new Error("Could not start media stream. Please ensure camera/microphone permissions are granted.");
        }

        attachStream(stream);
        return stream;
    } catch (err) {
        console.error("Failed to start stream", err);
        throw err;
    }
  }, []);

  const startMediaStreamRef = useRef(startMediaStream);
  startMediaStreamRef.current = startMediaStream;

  /** Show a stream in the viewfinder and read what its camera can do (zoom, torch, pan, tilt). */
  const attachStream = (stream: MediaStream) => {
        activeStreamRef.current = stream;
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            stream.getVideoTracks().forEach(t => t.enabled = isCameraActiveRef.current);
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrackRef.current = videoTrack;
            supportedConstraintsRef.current = navigator.mediaDevices.getSupportedConstraints();
            const caps: any = (videoTrack as any).getCapabilities?.() || {};
            capabilitiesRef.current = caps;

            setCanZoom(!!caps.zoom);
            if (caps.zoom) {
                setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
                setZoom(caps.zoom.min);
            }

            // Only a camera that says it has a torch shows the button (browser support alone isn't enough)
            setHasTorch(!!caps.torch);

            setCanPan(!!caps.pan);
            if (caps.pan) {
                setPanRange({ min: caps.pan.min, max: caps.pan.max, step: caps.pan.step || 1 });
                setPan(caps.pan.min);
            }

            setCanTilt(!!caps.tilt);
            if (caps.tilt) {
                setTiltRange({ min: caps.tilt.min, max: caps.tilt.max, step: caps.tilt.step || 1 });
                setTilt(caps.tilt.min);
            }
        }
  };

  /** Stop the camera and microphone that are running now (after a flip that is not the first stream). */
  const stopActiveStream = () => {
      activeStreamRef.current?.getTracks().forEach(t => t.stop());
      activeStreamRef.current = null;
  };

  /**
   * Flip the camera without touching the microphone: only the picture is swapped, so the guide keeps
   * hearing and sound recordings keep their sound. Not while recording (the clip would end).
   */
  const switchCameraMode = useCallback(async (mode: 'user' | 'environment'): Promise<boolean> => {
      if (mediaRecorderRef.current?.state === 'recording') return false;
      const old = activeStreamRef.current;
      if (!old) { setFacingMode(mode); await startMediaStream(mode); return true; }
      const prevMode = facingModeRef.current;
      // Some phones open one camera at a time: let go of the current one first
      old.getVideoTracks().forEach(t => t.stop());
      const tryVideo = async (c: MediaTrackConstraints | boolean) => { try { return await navigator.mediaDevices.getUserMedia({ video: c }); } catch { return null; } };
      let got = mode;
      let fresh = await tryVideo({ facingMode: mode });
      if (!fresh) { got = prevMode; fresh = (await tryVideo({ facingMode: prevMode })) || (await tryVideo(true)); }
      if (!fresh) { showStatus('error', "The camera couldn't switch. Close the Lens and open it again."); return false; }
      if (!activeStreamRef.current) { fresh.getTracks().forEach(t => t.stop()); return false; } // the Lens closed meanwhile
      if (got !== mode) showStatus('error', "This device has only one camera.");
      setFacingMode(got);
      attachStream(new MediaStream([...fresh.getVideoTracks(), ...old.getAudioTracks()]));
      return got === mode;
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMediaStream, facingMode]);

  useEffect(() => {
    isCameraActiveRef.current = isCameraActive;
    if (activeStreamRef.current) {
        activeStreamRef.current.getVideoTracks().forEach(track => { track.enabled = isCameraActive; });
    }
    // Notify agent of manual camera toggle
    if (geminiServiceRef.current?.isConnected()) {
        geminiServiceRef.current.sendText(`[SYSTEM: Camera is now ${isCameraActive ? 'ACTIVE' : 'INACTIVE'}]`);
    }
  }, [isCameraActive]);

  const handleToolCall = async (name: string, args: any) => {
    if (name === 'get_session_status') {
        return {
            camera_active: isCameraActiveRef.current,
            facing_mode: facingModeRef.current,
            recording_audio: isRecordingAudio,
            recording_video: isRecordingVideo,
            zoom_level: zoom,
            torch_active: torch
        };
    }
    if (name === 'adjust_optical_settings') {
        setAiOpticActive(true);
        await applyOpticalSettings({
            zoom: args.zoom_level,
            torch: args.torch_active,
            pan: args.pan,
            tilt: args.tilt
        });
        setTimeout(() => setAiOpticActive(false), 2000);
        return { result: "ok" };
    }
    if (name === 'switch_camera') {
        // The guide may never turn on the front (selfie) camera: only the explorer does, with Flip
        if (args.facing_mode === 'user') {
            return { result: "Not switched. You may never turn on the front (selfie) camera. If the explorer wants it, ask them to tap Flip." };
        }
        if (facingModeRef.current === 'environment') return { result: "The back camera is already on." };
        const ok = await switchCameraMode('environment');
        if (ok) showGuideNote('Your guide switched to the back camera.');
        return { result: ok ? "Switched to the back camera." : "The camera could not switch." };
    }
    if (name === 'end_session') { finalizeSession(args.summary, { quiet: true }); return { result: "ok" }; }
    if (name === 'set_camera_state') {
        // The guide may turn the camera off, never back on: the explorer chose to listen only
        if (args.is_active) return isCameraActiveRef.current ? { result: "The camera is already on." } : { result: "Not changed. Ask the explorer to tap the shutter if they want the camera back on." };
        if (isCameraActiveRef.current) { setIsCameraActive(false); showGuideNote('Your guide turned the camera off. Tap the shutter to turn it on.'); }
        return { result: "ok" };
    }
    if (name === 'trigger_capture') {
        // Nothing is ever captured without the explorer's own tap
        showGuideNote('Your guide suggests a photo. Tap the shutter.', 6000);
        const what = String(args.label || (Array.isArray(args.labels) ? args.labels[0] : '') || '').slice(0, 60);
        return { result: `Not captured. You never take photos yourself. Ask the explorer to tap the shutter${what ? ` if they want to keep the ${what}` : ''}; it will be identified then.` };
    }
    return { result: "ok" };
  };

  const playAudioData = (audioBuffer: AudioBuffer) => {
    if (audioMode === 'silent' || !audioContext) return;
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0 && agentState !== 'FINALIZING' && agentState !== 'RECONNECTING') setAgentState('IDLE');
    };
  };

  useEffect(() => {
    if (!hasSelectedMode) return;
    if ("geolocation" in navigator) {
        // Exact coordinates stay on the device (the private rawLocation). Only coordinates rounded to
        // about 1 km go to the town lookup and the live guide, and the town is looked up again only
        // after moving more than a kilometre, not on every update.
        let lookedUpAt: { lat: number; lng: number } | null = null;
        let lookingUp = false;
        locationWatchIdRef.current = navigator.geolocation.watchPosition(
            async (position) => {
                const lat = position.coords.latitude, lng = position.coords.longitude;
                const coarse = { lat: coarsenCoordinate(lat), lng: coarsenCoordinate(lng) };
                lastLocationRef.current = { lat, lng, name: lastLocationRef.current?.name };
                if (geminiServiceRef.current) geminiServiceRef.current.setLocation(coarse.lat, coarse.lng);
                if (lookingUp || (lookedUpAt && distanceKm(lookedUpAt, coarse) < 1)) return;
                lookingUp = true;
                lookedUpAt = coarse;
                let name: string | undefined;
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coarse.lat}&lon=${coarse.lng}&zoom=10&addressdetails=1`);
                    if (res.ok) {
                        const data = await res.json();
                        const a = data?.address;
                        name = (a && (a.city || a.town || a.village || a.county || a.state)) || undefined;
                    }
                } catch (e) {
                    console.warn("Town lookup failed; no place name for now", e);
                    lookedUpAt = null; // try again on the next update
                } finally {
                    lookingUp = false;
                }
                // Without a town, nothing stands in for it (never the coordinates)
                if (lastLocationRef.current) lastLocationRef.current = { ...lastLocationRef.current, name };
            },
            undefined,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }
    return () => { if (locationWatchIdRef.current !== null) navigator.geolocation.clearWatch(locationWatchIdRef.current); };
  }, [hasSelectedMode]);

  // The guide's instructions and model are set by the admin on the server; the app sends only
  // session context (memory, mode, season), which the server passes as information.
  const userIdValue = userMode?.userId;

  const initSession = useCallback(async () => {
      if (!audioContext || isTourActive || !hasSelectedMode) {
          console.debug("initSession skipped:", { hasAudioContext: !!audioContext, isTourActive, hasSelectedMode });
          return;
      }

      if (geminiServiceRef.current) {
          geminiServiceRef.current.disconnect();
          geminiServiceRef.current = null;
      }

      let inputCtx: AudioContext | null = null;
      let processor: ScriptProcessorNode | null = null;
      let videoInterval: number | null = null;

      try {
        console.debug("initSession starting...");
        if (audioContext.state === 'suspended') {
            console.debug("Resuming audioContext...");
            await audioContext.resume();
        }
        // Personal memory only for signed-in explorers (no device fingerprinting)
        const nId = userIdValue && userIdValue !== 'explorer_guest' ? userIdValue : "";
        setNaturalistId(nId);
        const memory = nId ? await FirebaseService.getNaturalistMemory(nId) : null;

        console.debug("Starting media stream...");
        const stream = await startMediaStream('environment');
        console.debug("Media stream started.");

        if (selectedMode === 'observation') {
            // Quiet observer: no live AI connection; each capture is identified in the background
            setAgentState('IDLE');
            return () => { stream.getTracks().forEach(t => t.stop()); stopActiveStream(); };
        }

        liveErrorRef.current = null;
        const service: GeminiLiveService = new GeminiLiveService(audioContext, {
            onAudioData: playAudioData,
            onInterrupted: () => { stopAllAudio(); if(agentState !== 'FINALIZING') setAgentState('HEARING_USER'); },
            onTranscript: (text, isUser, links) => addToChat(isUser ? 'user' : 'assistant', text, links),
            onTurnComplete: () => { setLiveCaption(""); },
            onToolCall: handleToolCall,
            onConnectionStateChange: (state) => {
                console.debug("Connection state changed:", state);
                // Ending, or a guide this Lens already let go of: nothing to say
                if (finalizingRef.current || geminiServiceRef.current !== service) return;
                switch (state) {
                    case 'CONNECTED':
                        liveWaitSinceRef.current = null;
                        setAgentState('IDLE');
                        // A conversation counts towards today's three only once the guide is really there
                        if (!countedConversationRef.current) {
                            countedConversationRef.current = true;
                            RateLimitService.incrementConversation(userMode?.userId || 'explorer_guest');
                        }
                        if (!conversationEndsAtRef.current) {
                            const startedAt = Date.now();
                            conversationEndsAtRef.current = startedAt + CONVERSATION_FALLBACK_MS;
                            getMyAllowance().then(a => {
                                if (!a) return;
                                const leftMs = Math.max(0, a.liveMinutes.limit * 60_000 - (a.liveMinutes.usedMs ?? a.liveMinutes.used * 60_000));
                                conversationEndsAtRef.current = startedAt + leftMs;
                            });
                        }
                        break;
                    case 'RECONNECTING':
                        if (typeof navigator !== 'undefined' && navigator.onLine === false) { fallBackRef.current(liveFailureReason()); break; }
                        if (!liveWaitSinceRef.current) liveWaitSinceRef.current = Date.now();
                        setAgentState('RECONNECTING');
                        break;
                    case 'DISCONNECTED':
                        // The final failure: Talk turns off and the quiet Lens carries on, with the reason
                        fallBackRef.current(liveFailureReason(liveErrorRef.current));
                        break;
                }
            },
            onError: (err: any) => {
                console.error("GeminiLiveService error delegate:", err);
                liveErrorRef.current = err;
                if (err?.governed) track('live_session_limited', { code: err.code });
            }
        });

        // glossary-ok: prompt text for the model, not shown to people
        const memoryContext = memory ? `[NATURALIST PROFILE: ${memory.preferredStyle}. Last summary: ${memory.lastSessionSummary}]` : '';

        const modeInstruction = "\n[MODE: CONVERSATION. You are an active field companion. Engage in real-time dialogue, ask questions, and be highly interactive. Your goal is to be a conversational partner in this exploration.]";

        // The fortnight's naturalist shapes what the guide gently encourages explorers to notice
        const theme = getDailyThemeConst();
        const extra = getNaturalistExtra(theme.id);
        const fortnight = `\n[THIS FORTNIGHT HONOURS ${theme.naturalist.toUpperCase()}: "${extra.philosophy}" When natural, invite the explorer to notice ${extra.lensPrompt}. Mention the community challenge only if relevant: ${extra.challenge}]`;
        service.setSystemInstruction(memoryContext + "\n" + modeInstruction + fortnight);
        // Only coarse (~1 km) coordinates leave the device for the live guide
        if (lastLocationRef.current) service.setLocation(coarsenCoordinate(lastLocationRef.current.lat), coarsenCoordinate(lastLocationRef.current.lng));

        console.debug("Connecting service...");
        liveWaitSinceRef.current = Date.now();
        service.connect(); // Do not await to avoid blocking initialization if connection hangs
        geminiServiceRef.current = service;

        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        inputCtx = new AudioContextClass({ sampleRate: 16000 });
        if (inputCtx.state === 'suspended') {
            console.debug("Resuming inputCtx...");
            await inputCtx.resume();
        }

        const sourceNode = inputCtx.createMediaStreamSource(stream);

        // --- Dual-Path Audio Routing Setup ---
        // Path A: To Agent (always on)
        const agentGainNode = inputCtx.createGain();
        agentGainNode.gain.value = 1;
        agentGainNodeRef.current = agentGainNode;
        sourceNode.connect(agentGainNode);

        // Path B: To Recording (can be muted)
        const recordingGainNode = inputCtx.createGain();
        recordingGainNode.gain.value = 1; // Default to unmuted
        recordingGainNodeRef.current = recordingGainNode;
        sourceNode.connect(recordingGainNode);

        const recordingDestination = inputCtx.createMediaStreamDestination();
        recordingDestinationRef.current = recordingDestination;
        recordingGainNode.connect(recordingDestination);
        // -------------------------------------

        processor = inputCtx.createScriptProcessor(4096, 1, 1);
        // Only sound around speech goes to the guide: silence is billed like speech, and a session that
        // sends nothing is closed by the server after a minute. A chunk of pre-roll keeps the first word,
        // and 1.5 s of hang-over lets the guide hear that the explorer has finished.
        let preRoll: Float32Array | null = null;
        processor.onaudioprocess = (e) => {
            const pcm = e.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
            const rms = Math.sqrt(sum / (pcm.length / 4));
            const now = Date.now();
            const voiced = rms > 0.012;
            const wasQuiet = now - lastVoiceRef.current > 1500;
            if (voiced) lastVoiceRef.current = now;
            if (geminiServiceRef.current && geminiServiceRef.current.isConnected()) {
                if (now - lastVoiceRef.current <= 1500) {
                    if (voiced && wasQuiet && preRoll) service.sendAudioChunk(preRoll);
                    service.sendAudioChunk(pcm);
                }
            }
            preRoll = new Float32Array(pcm);
        };
        agentGainNode.connect(processor);
        processor.connect(inputCtx.destination);

        // Stream frames to the guide at <=768px (the model's working resolution) and skip
        // near-identical frames: same accuracy, far less bandwidth and cost.
        const streamCanvas = document.createElement('canvas');
        const probe = document.createElement('canvas'); probe.width = 16; probe.height = 16;
        let lastProbe: Uint8ClampedArray | null = null;
        let lastSent = 0;
        videoInterval = window.setInterval(() => {
             const v = videoRef.current;
             if (!v || !isCameraActiveRef.current || !geminiServiceRef.current?.isConnected() || !v.videoWidth) return;
             const pctx = probe.getContext('2d', { willReadFrequently: true });
             if (pctx) {
                 pctx.drawImage(v, 0, 0, 16, 16);
                 const px = pctx.getImageData(0, 0, 16, 16).data;
                 let diff = 0;
                 if (lastProbe) for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i] - lastProbe[i]) + Math.abs(px[i + 1] - lastProbe[i + 1]) + Math.abs(px[i + 2] - lastProbe[i + 2]);
                 const still = lastProbe && diff / (16 * 16 * 3) < 6;
                 lastProbe = px;
                 if (still && Date.now() - lastSent < 4000) return;
                 // Nothing moving and nobody speaking or touching for 20 s: send nothing (a phone left on a table)
                 if (still && Date.now() - Math.max(lastVoiceRef.current, lastInteractionRef.current) > 20_000) return;
             }
             const scale = Math.min(1, 768 / Math.max(v.videoWidth, v.videoHeight));
             streamCanvas.width = Math.round(v.videoWidth * scale);
             streamCanvas.height = Math.round(v.videoHeight * scale);
             const sctx = streamCanvas.getContext('2d');
             if (!sctx) return;
             sctx.drawImage(v, 0, 0, streamCanvas.width, streamCanvas.height);
             service.sendVideoFrame(streamCanvas.toDataURL('image/jpeg', 0.6));
             lastSent = Date.now();
        }, 1000);

        console.debug("initSession complete.");
        return () => {
            console.debug("initSession cleanup...");
            if (geminiServiceRef.current) {
                geminiServiceRef.current.disconnect();
                geminiServiceRef.current = null;
            }
            if (videoInterval) clearInterval(videoInterval);
            if (processor) processor.disconnect();
            if (inputCtx) inputCtx.close();
            stopActiveStream();
        };
      } catch (err: any) {
          console.error("Session init failed:", err);
          setAgentState('DISCONNECTED');
          const name = err?.name || '';
          track('lens_error', { name: name || 'unknown' });
          if (name === 'NotAllowedError' || name === 'SecurityError') {
              setSessionError({ title: "Camera & microphone needed", message: "NatureGram needs camera and microphone access to see and hear nature with you. Allow access in your browser's site settings (the icon next to the address bar), then tap Retry." });
          } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
              setSessionError({ title: "No camera found", message: "We couldn't find a camera on this device. You can still bring in photos, videos or sounds from your camera roll.", action: 'roll' });
          } else if (name === 'NotReadableError') {
              setSessionError({ title: "Camera is busy", message: "Another app is using your camera. Close it and tap Retry." });
          } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
              setSessionError({ title: "You're offline", message: "The live guide needs an internet connection. You can keep capturing: while the Lens is open, your guide names your captures once you're back online. You can also name them yourself in review." });
          }
          return () => {
              if (geminiServiceRef.current) {
                  geminiServiceRef.current.disconnect();
                  geminiServiceRef.current = null;
              }
              if (videoInterval) clearInterval(videoInterval);
              if (processor) processor.disconnect();
              if (inputCtx) inputCtx.close();
              stopActiveStream(); // the camera may already be on when a later step fails
          };
      }
  }, [audioContext, isTourActive, hasSelectedMode, userIdValue, selectedMode]);

  /**
   * The live guide failed for good (offline, allowance used, unavailable): Talk turns off and the quiet
   * Lens carries on, saying why. The explorer's saved choice is left as it was for next time.
   */
  fallBackRef.current = (reason: string) => {
      if (finalizingRef.current || selectedMode !== 'conversation') return;
      liveWaitSinceRef.current = null;
      track('lens_live_fallback', { offline: typeof navigator !== 'undefined' && navigator.onLine === false });
      stopAllAudio();
      setLiveCaption('');
      setSecondsLeft(null);
      setAgentState('BOOTING');
      setAudioMode('silent');
      setSelectedMode('observation');
      showStatus('error', `${reason.replace(/\s*$/, '')} Talk is off; your guide still names your captures afterwards.`, 9000);
  };
  useEffect(() => {
      if (selectedMode !== 'conversation') return;
      const off = () => fallBackRef.current(liveFailureReason());
      window.addEventListener('offline', off);
      return () => window.removeEventListener('offline', off);
  }, [selectedMode]);

  // The first "Talk with me" says once that the guide is an AI (the first-visit line says it otherwise)
  useEffect(() => {
      if (selectedMode !== 'conversation') return;
      let seen = false;
      try { seen = !!localStorage.getItem(TALK_AI_KEY); localStorage.setItem(TALK_AI_KEY, '1'); } catch { seen = true; }
      if (!seen && !firstLine) showGuideNote(AI_LINE, 8000);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMode]);

  /** "Talk with me": turn the talkative guide on or off. The choice is remembered for later visits. */
  const setTalkative = (on: boolean) => {
      const next: 'observation' | 'conversation' = on ? 'conversation' : 'observation';
      if (next === selectedMode || agentState === 'FINALIZING') return;
      if (on) {
          const uid = userMode?.userId || 'explorer_guest';
          if (!RateLimitService.canStartConversation(uid)) {
              showStatus('error', "Today's conversations are used. They refresh tomorrow.");
              return;
          }
          countedConversationRef.current = false; // counted when the guide connects
      }
      try { localStorage.setItem(LENS_MODE_KEY, next); } catch { /* storage blocked */ }
      track('lens_mode_switch', { mode: next });
      stopAllAudio();
      setSessionError(null);
      setLiveCaption('');
      setAgentState('BOOTING');
      setAudioMode(on ? 'voice' : 'silent');
      setSelectedMode(next); // initSession depends on the mode, so the session restarts gracefully
  };

  const cleanupRef = useRef<(() => void) | null>(null);
  const rollInputRef = useRef<HTMLInputElement>(null);
  const openCameraRoll = () => {
      if (onImportFromRoll && captureCountRef.current === 0) onImportFromRoll();
      else rollInputRef.current?.click();
  };

  useEffect(() => {
    let active = true;

    if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
    }

    initSession().then(c => {
        if (active && c) cleanupRef.current = c;
        else if (c) c();
    });

    return () => {
        active = false;
        if (cleanupRef.current) {
            cleanupRef.current();
            cleanupRef.current = null;
        }
    };
  }, [initSession]);

  return (
    <div className="relative h-full w-full bg-black overflow-hidden font-body flex flex-col">
      <style>{BREATHE_CSS}</style>
      <div className={`absolute inset-0 bg-white z-[100] transition-opacity duration-150 pointer-events-none ${isFlashing ? 'opacity-100' : 'opacity-0'}`} />

      {/* Top bar: close where people look for it, the guide switch and Done on the right */}
      <div className="absolute safe-top inset-x-4 md:inset-x-8 z-[120] flex items-center justify-between gap-2 pointer-events-none">
          <button
              onClick={() => (captureCount > 0 || isRecordingAudio || isRecordingVideo ? finalizeSession() : onExit())}
              aria-label={captureCount > 0 ? 'Close the Lens and review your captures' : 'Close the Lens'}
              className="pointer-events-auto w-11 h-11 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center transition-colors hover:bg-black/55"
          >
              <Glyph name="close" size={20} />
          </button>
          <div className="flex items-center gap-2 pointer-events-auto">
              <button
                  role="switch"
                  aria-checked={selectedMode === 'conversation'}
                  onClick={() => setTalkative(selectedMode !== 'conversation')}
                  className="h-11 pl-4 pr-2.5 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center gap-2.5 transition-colors hover:bg-black/55 text-sm font-medium"
              >
                  <span className="whitespace-nowrap">Talk with me</span>
                  <span aria-hidden="true" className={`relative w-9 h-5 rounded-full transition-colors ${selectedMode === 'conversation' ? 'bg-theme-vivid' : 'bg-white/25'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${selectedMode === 'conversation' ? 'left-[18px]' : 'left-0.5'}`} />
                  </span>
              </button>
              <div className="relative">
                  <button
                      onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      aria-label="More Lens options"
                      className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center transition-colors hover:bg-black/55"
                  >
                      <Glyph name="more" size={20} />
                  </button>
                  {menuOpen && (
                      <>
                          <div className="fixed inset-0" onClick={closeMenu} aria-hidden="true" />
                          <div role="menu" className="absolute right-0 top-12 w-64 bg-black/80 backdrop-blur-xl rounded-xl p-1.5 shadow-[0_18px_44px_-18px_rgba(0,0,0,0.8)]">
                              <button
                                  role="menuitemcheckbox"
                                  aria-checked={!isCameraActive}
                                  onClick={() => { setIsCameraActive(!isCameraActive); closeMenu(); }}
                                  className="w-full flex items-center gap-3 px-3 min-h-[48px] rounded-lg text-left text-[15px] text-white hover:bg-white/10"
                              >
                                  <Glyph name={isCameraActive ? 'ear' : 'video'} size={20} />
                                  <span className="flex-1">{isCameraActive ? 'Listen only' : 'Use the camera again'}</span>
                              </button>
                              {isCameraActive && !isRecordingAudio && (
                                  <button
                                      role="menuitem"
                                      onClick={() => { closeMenu(); toggleClip(); }}
                                      className="w-full flex items-center gap-3 px-3 min-h-[48px] rounded-lg text-left text-[15px] text-white hover:bg-white/10"
                                  >
                                      <Glyph name="video" size={20} />
                                      <span className="flex-1">{isRecordingVideo ? 'Stop the clip' : 'Start a clip (up to 30 seconds)'}</span>
                                  </button>
                              )}
                              <button
                                  role="menuitem"
                                  onClick={() => { closeMenu(); openCameraRoll(); }}
                                  className="w-full flex items-center gap-3 px-3 min-h-[48px] rounded-lg text-left text-[15px] text-white hover:bg-white/10"
                              >
                                  <Glyph name="plate" size={20} />
                                  <span className="flex-1">Bring in from your camera roll</span>
                              </button>
                          </div>
                      </>
                  )}
              </div>
              <button
                  onClick={() => finalizeSession()}
                  aria-label="Finish session and review captures"
                  className="h-11 px-5 rounded-full bg-white text-stone-900 flex items-center gap-1.5 transition-colors hover:bg-white/90 text-sm font-semibold"
              >
                  <Glyph name="check" size={20} className="hidden sm:inline" />Done
              </button>
          </div>
      </div>
      {showTranscript && selectedMode === 'conversation' && (
          <div className="absolute top-20 left-4 right-4 md:left-8 max-w-md z-[125] max-h-[50vh] overflow-y-auto no-scrollbar bg-black/75 backdrop-blur-xl rounded-2xl p-5 space-y-4" role="log" aria-label="Guide transcript" aria-live="polite">
              {chatHistory.filter(m => m.role !== 'system' && m.text).length === 0
                  ? <p className="font-display italic text-base text-white/70">Nothing said yet. Point the camera at something alive.</p>
                  : chatHistory.filter(m => m.role !== 'system' && m.text).map(m => (
                      <p key={m.id} className={`text-sm leading-relaxed ${m.role === 'user' ? 'text-white/70 text-right' : 'text-white'}`}>
                          <span className="block text-xs font-medium text-white/55 mb-1">{m.role === 'user' ? 'You' : 'Your guide'}</span>{m.text}
                      </p>
                  ))}
          </div>
      )}
      {secondsLeft !== null && selectedMode === 'conversation' && agentState !== 'FINALIZING' && (
          <div className="absolute top-[calc(var(--sat)+9.5rem)] left-1/2 -translate-x-1/2 z-[119] text-xs font-medium text-white/90 bg-black/40 backdrop-blur-md rounded-full px-3 py-1 tabular" role="timer" aria-live="off">
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} of live time left today
          </div>
      )}
      {idleWarning !== null && agentState !== 'FINALIZING' && (
          <div className="absolute inset-x-6 top-1/3 z-[130] mx-auto max-w-xs bg-black/70 backdrop-blur-xl text-white rounded-2xl p-6 text-center" role="alertdialog" aria-labelledby="idle-title">
              <p id="idle-title" className="ng-dark-title text-[20px]">{selectedMode === 'observation' ? 'Still watching?' : 'Still with me?'}</p>
              <p className="ng-dark-caption mt-1">{selectedMode === 'observation' ? `The Lens will rest in ${idleWarning}s.` : `I'll rest in ${idleWarning}s.`}</p>
              <button autoFocus onClick={() => { lastInteractionRef.current = Date.now(); setIdleWarning(null); }} className="ng-button-light mt-5 w-full justify-center px-6">Keep going</button>
          </div>
      )}
      {pendingAnalyses > 0 && (
          <div className="absolute top-[calc(var(--sat)+7rem)] left-1/2 -translate-x-1/2 z-[119] text-xs font-medium text-white/90 bg-black/40 backdrop-blur-md rounded-full px-3 py-1" role="status">
              Analysing {pendingAnalyses} capture{pendingAnalyses === 1 ? '' : 's'}…
          </div>
      )}

      <div className="absolute top-[calc(var(--sat)+4.25rem)] left-1/2 -translate-x-1/2 z-[118] pointer-events-auto flex items-center gap-2 max-w-[92vw]">
          {!analysisStatus && (
              <button
                  disabled={agentState !== 'DISCONNECTED'}
                  onClick={() => {
                      if (agentState === 'DISCONNECTED' && cleanupRef.current) {
                          setSessionError(null);
                          cleanupRef.current();
                          cleanupRef.current = null;
                          initSession().then(c => { if (c) cleanupRef.current = c; });
                      }
                  }}
                  className={`bg-black/45 backdrop-blur-md px-4 min-h-[36px] rounded-full flex items-center gap-2 transition-all duration-300 animate-in fade-in ${agentState === 'DISCONNECTED' ? 'cursor-pointer ring-1 ring-red-300/50' : 'cursor-default'}`}
              >
                  {getPebbleStyle().guide
                      ? <BreathingGuide size={14} still={getPebbleStyle().guide === 'still'} className={agentState === 'DISCONNECTED' ? 'text-red-300' : 'text-white/90'} />
                      : <Glyph name="eye" size={14} className="text-white/90" />}
                  <span className={`text-xs font-medium truncate ${agentState === 'DISCONNECTED' ? 'text-red-100' : 'text-white/90'}`}>
                      {getStatusText()}
                  </span>
              </button>
          )}

          {analysisStatus && (
              <div className={`bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border shadow-xl flex items-center gap-2 transition-all duration-300 animate-in fade-in ${analysisStatus.type === 'error' ? 'ring-1 ring-red-300/50' : ''}`}>
                  {analysisStatus.type === 'processing'
                      ? <BreathingGuide size={14} className="text-white/90" />
                      : <Glyph name={analysisStatus.type === 'success' ? 'check' : 'alert'} size={14} className={analysisStatus.type === 'success' ? 'text-theme-vivid' : 'text-red-300'} />}
                  <span role="status" className={`text-xs font-medium ${analysisStatus.type === 'error' ? 'text-red-100' : 'text-white/90'}`}>
                      {analysisStatus.text}
                  </span>
              </div>
          )}
          {selectedMode === 'conversation' && (
              <button
                  onClick={() => setShowTranscript(v => !v)}
                  aria-expanded={showTranscript}
                  aria-label="Transcript: what your guide said"
                  className={`shrink-0 min-h-[44px] px-3 rounded-full backdrop-blur-md text-white flex items-center gap-1.5 text-xs font-medium ${showTranscript ? 'bg-white/25' : 'bg-black/45'}`}
              >
                  <Glyph name="lines" size={16} />
                  <span className="hidden sm:inline">Transcript</span>
              </button>
          )}
      </div>
      {firstLine && agentState !== 'FINALIZING' && !sessionError && (
          <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+14.5rem)] inset-x-4 z-[117] flex justify-center pointer-events-none">
              <p className="pointer-events-auto max-w-sm bg-black/50 backdrop-blur-md text-white/90 rounded-full pl-4 pr-1 py-1 flex items-center gap-3 text-sm leading-snug">
                  <span className="block w-6 h-px bg-theme-vivid shrink-0" aria-hidden="true" />
                  <span>Point at anything alive and tap to capture. {AI_LINE}</span>
                  <button onClick={dismissFirstLine} aria-label="Dismiss" className="ng-icon-button-dark text-white/75">
                      <Glyph name="close" size={20} />
                  </button>
              </p>
          </div>
      )}

      {sessionError && (
          <div className="absolute inset-0 z-[110] bg-black/90 backdrop-blur-3xl flex flex-col items-center justify-center p-8 text-center pointer-events-auto">
              <BreathingGuide size={40} still className="text-white/50 mb-6" />
              <h2 className="ng-dark-title mb-4 max-w-md">{sessionError.title}</h2>
              <p className="text-base text-white/80 mb-10 max-w-md leading-[1.65]">{sessionError.message}</p>
               <div className="flex items-center gap-6">
                  <button
                      onClick={() => {
                          setSessionError(null);
                          if (cleanupRef.current) {
                              cleanupRef.current();
                              cleanupRef.current = null;
                          }
                          initSession().then(c => {
                              if (c) cleanupRef.current = c;
                          });
                      }}
                      className="ng-button-light"
                  >
                      Try again
                  </button>
                  <button
                      onClick={() => setSessionError(null)}
                      className="ng-link-light min-h-[44px]"
                  >
                      Not now
                  </button>
              </div>
              {sessionError.action === 'roll' && (
                  <button onClick={() => { setSessionError(null); openCameraRoll(); }} className="ng-button-light mt-6">
                      <Glyph name="plate" size={20} />Bring in from your camera roll
                  </button>
              )}
          </div>
      )}

      {agentState === 'FINALIZING' && (
          <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-8 text-center" role="status" aria-live="polite">
              {closing && closing.items.length > 0 ? (
                  <>
                      <div className="relative h-40 w-full max-w-xs mb-8" aria-hidden="true">
                          {closing.items.slice(-5).map((it, i, arr) => {
                              const mid = (arr.length - 1) / 2;
                              const angle = (i - mid) * 9;
                              const x = (i - mid) * 46;
                              return (
                                  <div
                                      key={i}
                                      className="ng-pin absolute left-1/2 top-2 w-24 rounded-md overflow-hidden shadow-[0_10px_24px_-10px_rgba(0,0,0,0.8)]"
                                      style={{ transform: `translateX(calc(-50% + ${x}px)) translateY(${Math.abs(i - mid) * 6}px) rotate(${angle}deg)`, animationDelay: `${i * 140}ms`, zIndex: 10 - Math.abs(Math.round(i - mid)) }}
                                  >
                                      <div className="aspect-square bg-stone-800 overflow-hidden flex items-center justify-center">
                                          {it.thumb ? <img src={it.thumb} alt="" className="w-full h-full object-cover" /> : <Glyph name={it.type === 'audio' ? 'sound' : 'leaf'} size={24} strokeWidth={1.2} className="text-white/50" />}
                                      </div>
                                      {it.name && <p className="absolute inset-x-0 bottom-0 px-1.5 pb-1 pt-4 bg-gradient-to-t from-black/70 to-transparent font-display italic text-[12px] leading-tight text-white truncate">{it.name}</p>}
                                  </div>
                              );
                          })}
                      </div>
                      <p className="flex items-center justify-center gap-3 text-sm text-white/70 mb-4"><span className="block w-8 h-px bg-theme-vivid" aria-hidden="true" />The guide</p>
                      <h2 className="ng-dark-title mb-2">Closing the notebook</h2>
                      <p className="ng-dark-caption">
                          {closing.minutes === 1 ? 'A minute' : `${closing.minutes} minutes`} outside{closing.place ? `, near ${closing.place}` : ''} · {closing.items.length} {closing.items.length === 1 ? 'capture' : 'captures'}
                      </p>
                  </>
              ) : (
                  <>
                      <BreathingGuide size={36} className="text-white/70 mb-6" />
                      <h2 className="ng-dark-title mb-2">Closing the notebook</h2>
                      {closing && <p className="ng-dark-caption">{closing.minutes === 1 ? 'A minute' : `${closing.minutes} minutes`} outside{closing.place ? `, near ${closing.place}` : ''}.</p>}
                  </>
              )}
          </div>
      )}


      {/* The sighting as a specimen tag: rests until the next capture or until put away */}
      <AnimatePresence>
          {latestSighting && <SightingTag key={latestSighting.id} card={latestSighting} reduceMotion={!!reduceMotion} onClose={() => setLatestSighting(null)} />}
      </AnimatePresence>

      <div className="absolute inset-0 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${isCameraActive ? 'opacity-100 scale-105' : 'opacity-40 blur-[60px]'}`} />
        <canvas ref={canvasRef} className="hidden" />
        <input ref={rollInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={handleMediaUpload} />
      </div>

      <div className="absolute top-[calc(var(--sat)+12rem)] left-1/2 -translate-x-1/2 z-[119] w-max max-w-[62vw] pointer-events-none" role="status" aria-live="polite">
          {(guideNote || aiOpticActive) && agentState !== 'FINALIZING' && (
              <div className="bg-black/55 backdrop-blur-md px-4 py-2 rounded-2xl flex items-center gap-2 animate-fade-in">
                  <BreathingGuide size={14} still={!!reduceMotion} className="text-white/90 shrink-0" />
                  <span className="text-sm font-medium text-white leading-snug">{guideNote || 'Your guide is adjusting the camera'}</span>
              </div>
          )}
      </div>

      {isCameraActive && canZoom && (
          <div className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-[50] flex flex-col items-center gap-3 bg-black/35 backdrop-blur-xl py-3 px-1 rounded-full">
              <button onClick={() => applyOpticalSettings({ zoom: zoom + 0.5 })} aria-label="Zoom in" className="ng-icon-button-dark"><Glyph name="plus" size={20} /></button>
              <div className="relative h-40 w-11">
                  <input
                      id="lens-zoom"
                      type="range"
                      min={zoomRange.min} max={zoomRange.max} step={zoomRange.step} value={zoom}
                      aria-valuetext={`${zoom.toFixed(1)} times`}
                      onChange={(e) => applyOpticalSettings({ zoom: parseFloat(e.target.value) })}
                      className="ng-zoom absolute left-1/2 top-1/2 w-40 h-11 -translate-x-1/2 -translate-y-1/2 -rotate-90"
                  />
              </div>
              <button onClick={() => applyOpticalSettings({ zoom: zoom - 0.5 })} aria-label="Zoom out" className="ng-icon-button-dark"><Glyph name="minus" size={20} /></button>
              <label htmlFor="lens-zoom" className="text-center pb-1 cursor-pointer">
                  <span className="text-[11px] font-medium text-white/75 block">Zoom</span>
                  <span className="text-xs font-medium text-white/90 block tabular">{zoom.toFixed(1)}×</span>
              </label>
          </div>
      )}

      {isCameraActive && (
          <div className="absolute left-4 md:left-8 top-[calc(var(--sat)+9rem)] z-50 flex flex-col gap-4">
              {hasTorch && (
                <button onClick={() => applyOpticalSettings({ torch: !torch })} aria-pressed={torch} aria-label="Torch" className={`w-14 h-14 rounded-full backdrop-blur-xl transition-colors flex flex-col items-center justify-center gap-0.5 ${torch ? 'bg-white text-stone-900' : 'bg-black/40 text-white/85'}`}>
                    <Glyph name={torch ? 'torch' : 'torchOff'} size={20} />
                    <span className="text-[11px] font-medium">Torch</span>
                </button>
              )}
              <button onClick={() => switchCameraMode(facingMode === 'environment' ? 'user' : 'environment')} aria-label="Switch camera" className="w-14 h-14 rounded-full backdrop-blur-xl text-white/85 flex flex-col items-center justify-center gap-0.5 bg-black/40 transition-colors hover:bg-black/55">
                  <Glyph name="rotate" size={20} />
                  <span className="text-[11px] font-medium">Flip</span>
              </button>


          </div>
      )}



      <div className="flex-1 flex flex-col justify-end items-center pointer-events-none relative z-20 pb-20">
          <AudioVisualizer isActive={agentState === 'SPEAKING'} color="bg-theme-vivid" />
          <div className="mt-8 px-10 text-center">
              {liveCaption && (
                  <div className="animate-fade-in bg-black/45 backdrop-blur-xl px-7 py-5 rounded-2xl max-w-sm mx-auto">
                      <p className="text-xs font-medium mb-3 text-white/70 flex items-center justify-center gap-3"><span className="block w-6 h-px bg-theme-vivid" aria-hidden="true" />Your guide</p>
                      <p className="font-display italic text-[20px] text-white leading-[1.35]">"{liveCaption}"</p>
                  </div>
              )}
          </div>
      </div>

      <div className="relative z-40 p-8 pt-0 safe-pb">
          <div className="flex items-end justify-between max-w-md mx-auto pointer-events-auto">
              {selectedMode !== 'conversation' ? <span className="w-14" aria-hidden="true" /> : <div className="flex flex-col items-center gap-1.5">
                  <button
                      onClick={() => setIsMuted(m => !m)}
                      aria-pressed={isMuted}
                      aria-label={isMuted ? 'Unmute: let your guide hear you' : 'Mute: your guide stops listening'}
                      className={`w-14 h-14 rounded-full backdrop-blur-xl flex items-center justify-center transition-colors ${isMuted ? 'bg-white text-stone-900' : 'bg-black/40 text-white hover:bg-black/55'}`}
                  >
                      <Glyph name={isMuted ? 'micOff' : 'mic'} size={24} />
                  </button>
                  <span className="text-xs font-medium text-white/85">{isMuted ? 'Muted' : 'Talk'}</span>
              </div>}

                  <div className="flex flex-col items-center gap-2 relative">
                      {lastAudioSnapshotId && !isRecordingAudio && !isRecordingVideo && (
                          <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-[60] w-48 pointer-events-none animate-fade-in">
                              <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2.5 rounded-xl relative text-center">
                                  <p className="text-sm font-medium leading-snug">
                                      Pair a photo with that sound
                                  </p>
                              </div>
                          </div>
                      )}
                      <span className="text-xs font-medium text-white/90 bg-black/40 px-3 py-1 rounded-full backdrop-blur-md whitespace-nowrap">
                          {isRecordingVideo ? 'Release to stop' : isCameraActive ? "Tap to capture · hold for a clip" : "Tap to turn camera on"}
                      </span>
                      <button
                          onPointerDown={handleShutterPress}
                          onPointerUp={handleShutterRelease}
                          onPointerLeave={() => { if (holdTimeoutRef.current || isRecordingVideo) handleShutterRelease(); }}
                          onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              e.preventDefault();
                              if (e.repeat) return;
                              if (e.shiftKey) { toggleClip(); return; }
                              handleShutterPress(); window.setTimeout(handleShutterRelease, 50);
                          }}
                          aria-label={isRecordingVideo ? 'Stop the clip' : isCameraActive ? 'Capture a photo. Hold to capture a clip' : 'Turn camera on'}
                          aria-description={isCameraActive ? (isRecordingVideo ? 'Shift+Enter stops the clip.' : 'Shift+Enter starts a clip of up to 30 seconds; Shift+Enter again stops it.') : undefined}
                          className="group relative w-24 h-24 flex items-center justify-center active:scale-95 transition-transform touch-none"
                      >
                          <div className={`absolute inset-0 rounded-full border-2 transition-colors duration-500 ${isCameraActive ? 'border-white/85' : 'border-white/25'} ${isRecordingVideo ? 'border-red-500' : ''}`} />

                          {isRecordingVideo && (
                              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                                  <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(239, 68, 68, 0.2)" strokeWidth="8" />
                                  <circle cx="50" cy="50" r="46" fill="none" stroke="#ef4444" strokeWidth="8" strokeDasharray="289" strokeDashoffset={289 - (289 * (30 - recordingTime) / 30)} className="transition-all duration-1000 ease-linear" />
                              </svg>
                          )}

                          <div className={`w-[76px] h-[76px] rounded-full flex items-center justify-center transition-colors ${isRecordingVideo ? 'bg-red-600 text-white' : isCameraActive ? 'bg-white text-stone-900' : 'bg-white/10 text-white/70'}`}>
                              <Glyph name={isRecordingVideo ? 'video' : isCameraActive ? 'camera' : 'eye'} size={28} />
                          </div>
                      </button>
                  </div>
              <div className="flex flex-col items-center gap-1.5">
                  <button
                      onClick={toggleSoundRecording}
                      disabled={isRecordingVideo}
                      aria-pressed={isRecordingAudio}
                      aria-label={isRecordingAudio ? `Stop sound recording, ${recordingTime} seconds left` : 'Capture a sound (up to 30 seconds)'}
                      className={`w-14 h-14 rounded-full backdrop-blur-xl flex flex-col items-center justify-center transition-colors disabled:opacity-40 ${isRecordingAudio ? 'bg-red-600 text-white' : 'bg-black/40 text-white hover:bg-black/55'}`}
                  >
                      <Glyph name={isRecordingAudio ? 'stop' : 'sound'} size={24} />
                      {isRecordingAudio && <span className="text-[11px] font-semibold tabular">{recordingTime}s</span>}
                  </button>
                  <span className="text-xs font-medium text-white/85">{isRecordingAudio ? 'Stop' : 'Sound'}</span>
              </div>

          </div>
      </div>
    </div>
  );
};

export default LiveLens;
