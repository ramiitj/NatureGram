
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GeminiLiveService } from '../services/geminiLiveService.ts';
import AudioVisualizer from './AudioVisualizer.tsx';
import { Snapshot, GeminiConfig, UserMode, ChatMessage, GroundingLink, AudioMode } from '../types.ts';
import { compressImageToBlob } from '../services/audioUtils.ts';
import { FirebaseService } from '../services/firebaseService.ts';
import { FingerprintService } from '../services/fingerprintService.ts';
import { GenAiService, resolveNatureSubjectFields, normalizeLabels } from '../services/genAiService.ts';
import { prepareUpload, analyzeUploadedMedia, UploadValidationError } from '../services/uploadService.ts';
import { LIVE_STREAM_FRAME_MAX_DIMENSION } from '../constants.ts';
import OnboardingTour from './OnboardingTour.tsx';
import { motion, AnimatePresence } from 'motion/react';

interface LiveLensProps {
  onCapture: (snap: Snapshot) => void;
  onEndSession: (summary: string) => void;
  onExit: () => void;
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
}

type AgentState = 'BOOTING' | 'IDLE' | 'HEARING_USER' | 'THINKING' | 'SPEAKING' | 'DISCONNECTED' | 'RECONNECTING' | 'FINALIZING';

const LiveLens: React.FC<LiveLensProps> = ({ onCapture, onEndSession, onExit, config, userMode, audioContext, isFirstTime, isFinalizing, geminiServiceRef, updateSnapshot, pendingSnapshotIdRef, initialAudioMode = 'voice', selectedMode = 'conversation' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const isCameraActiveRef = useRef(false); 
  
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
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
  const [micUnavailable, setMicUnavailable] = useState(false);
  const micUnavailableRef = useRef(false);

  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const capabilitiesRef = useRef<any>({});
  const supportedConstraintsRef = useRef<MediaTrackSupportedConstraints>({});

  const [agentState, setAgentState] = useState<AgentState>('BOOTING');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [liveCaption, setLiveCaption] = useState(""); 
  const [isTourActive, setIsTourActive] = useState(isFirstTime); 
  
  const [audioMode, setAudioMode] = useState<AudioMode>(initialAudioMode);
  const [hasSelectedMode, setHasSelectedMode] = useState(true);
  const [isProcessingCapture, setIsProcessingCapture] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<{type: 'success' | 'error' | 'processing', text: string} | null>(null);
  const [latestSighting, setLatestSighting] = useState<{labels: string[], behavior: string, aiInsight: string} | null>(null);

  useEffect(() => {
    if (!latestSighting) return;
    const timer = setTimeout(() => {
      setLatestSighting(null);
    }, 15000);
    return () => clearTimeout(timer);
  }, [latestSighting]);

  const showStatus = useCallback((type: 'success' | 'error' | 'processing', text: string) => {
      setAnalysisStatus({ type, text });
      if (type !== 'processing') {
          setTimeout(() => {
              setAnalysisStatus(current => {
                 if (current?.text === text && current?.type === type) return null;
                 return current;
              });
          }, 5000);
      }
  }, []);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const lastLocationRef = useRef<{lat: number, lng: number} | null>(null);
  const locationWatchIdRef = useRef<number | null>(null);

  const [naturalistId, setNaturalistId] = useState("");

  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showModalityTooltip, setShowModalityTooltip] = useState(false);
  const [showHelpSheet, setShowHelpSheet] = useState(false);
  const [showTourReplay, setShowTourReplay] = useState(false);
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

  // Idle-session auto-disconnect: a Live session is the most expensive
  // thing this app does, and it's easy to leave one open (phone put down,
  // tab left in the background). If there's been no speech from either
  // side, no camera motion, and no manual recording activity for this
  // long, end the session automatically — on top of (not instead of) the
  // server's hard 3-minute cap.
  const IDLE_SESSION_TIMEOUT_MS = 60000;
  // A hard cap on total active session time, independent of the idle
  // timeout above: the server already caps each WebSocket connection at 3
  // minutes (geminiProxy.js), but GeminiLiveService just reconnects and
  // continues, so a genuinely engaged user could otherwise run a session
  // indefinitely. 15 minutes is a generous single-sitting budget.
  const MAX_SESSION_DURATION_MS = 15 * 60 * 1000;
  const lastActivityAtRef = useRef<number>(Date.now());
  const isFinalizingRef = useRef(false);

  // Adaptive streaming frame rate: skip sending a frame to the Live agent
  // when the scene hasn't meaningfully changed since the last one sent
  // (e.g. the user is holding the camera steady while the agent talks).
  // A heartbeat still forces a send periodically so the agent's view never
  // goes stale for long. This only affects the continuous 1fps stream —
  // full-resolution capture for saved posts is unaffected.
  const frameDiffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameSignatureRef = useRef<Uint8ClampedArray | null>(null);
  const lastFrameSentAtRef = useRef<number>(0);
  const FRAME_DIFF_SIZE = 12;
  const FRAME_DIFF_THRESHOLD = 10; // avg per-channel delta (0-255) considered "changed"
  const FRAME_HEARTBEAT_MS = 4000; // always send at least this often

  const shouldSendStreamingFrame = useCallback((sourceCanvas: HTMLCanvasElement): boolean => {
    try {
      if (!frameDiffCanvasRef.current) {
        frameDiffCanvasRef.current = document.createElement('canvas');
        frameDiffCanvasRef.current.width = FRAME_DIFF_SIZE;
        frameDiffCanvasRef.current.height = FRAME_DIFF_SIZE;
      }
      const diffCanvas = frameDiffCanvasRef.current;
      const diffCtx = diffCanvas.getContext('2d');
      if (!diffCtx) return true; // fail open: send if we can't evaluate

      diffCtx.drawImage(sourceCanvas, 0, 0, FRAME_DIFF_SIZE, FRAME_DIFF_SIZE);
      const { data } = diffCtx.getImageData(0, 0, FRAME_DIFF_SIZE, FRAME_DIFF_SIZE);

      const now = Date.now();
      const heartbeatDue = now - lastFrameSentAtRef.current >= FRAME_HEARTBEAT_MS;
      const previous = lastFrameSignatureRef.current;
      lastFrameSignatureRef.current = data;

      if (!previous || heartbeatDue) {
        lastFrameSentAtRef.current = now;
        return true;
      }

      let diffSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        diffSum += Math.abs(data[i] - previous[i]) + Math.abs(data[i + 1] - previous[i + 1]) + Math.abs(data[i + 2] - previous[i + 2]);
      }
      const avgDiff = diffSum / ((data.length / 4) * 3);

      if (avgDiff >= FRAME_DIFF_THRESHOLD) {
        lastFrameSentAtRef.current = now;
        lastActivityAtRef.current = now; // real camera motion counts as activity (heartbeat sends don't)
        return true;
      }
      return false;
    } catch (e) {
      return true; // fail open: never let this block the actual stream
    }
  }, []);

  const captureFrame = useCallback((optimize: boolean = false): { dataUrl: string, blobPromise?: Promise<Blob> } | null => {
    if (!videoRef.current || !canvasRef.current || !isCameraActiveRef.current) return null;
    const canvas = canvasRef.current;
    const nativeWidth = videoRef.current.videoWidth;
    const nativeHeight = videoRef.current.videoHeight;
    if (nativeWidth > 0) {
        if (optimize) {
            // Full-quality capture (used for saved posts) keeps native resolution.
            canvas.width = nativeWidth;
            canvas.height = nativeHeight;
        } else {
            // Frames streamed continuously to the Live agent don't need
            // native resolution — downscale to cut vision-token cost.
            const scale = Math.min(1, LIVE_STREAM_FRAME_MAX_DIMENSION / Math.max(nativeWidth, nativeHeight));
            canvas.width = Math.max(1, Math.round(nativeWidth * scale));
            canvas.height = Math.max(1, Math.round(nativeHeight * scale));
        }
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
    lastActivityAtRef.current = Date.now();

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

    const recorder = new MediaRecorder(streamToRecord, { mimeType: type === 'video' ? 'video/webm' : 'audio/webm' });
    mediaRecorderRef.current = recorder;
    mediaChunksRef.current = [];
    pendingAssociatedImagesRef.current = [];
    setLastAudioSnapshotId(null);
    setLastAudioImages([]);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) mediaChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      const mediaBlob = new Blob(mediaChunksRef.current, { type: type === 'video' ? 'video/webm' : 'audio/webm' });
      
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
          const snapId = Date.now().toString();
          pendingSnapshotIdRef.current = snapId;
          setIsProcessingCapture(true);
          showStatus('processing', 'Analyzing field data...');
          
          if (type === 'audio') {
              setLastAudioSnapshotId(snapId);
              setLastAudioImages(pendingAssociatedImagesRef.current.length > 0 ? pendingAssociatedImagesRef.current : []);
          }
          
          const isAudioOnly = type === 'audio' && !imgBlob;
          const prompt = isAudioOnly 
            ? "I just captured an audio snippet. The system is analyzing it in the background. Please acknowledge this and wait for the results."
            : `I just captured ${type === 'audio' ? 'an audio recording' : `a ${type}`}. The system is analyzing it in the background. Please acknowledge this and wait for the results.`;

          const location = lastLocationRef.current ? (lastLocationRef.current as any).name || `${lastLocationRef.current.lat},${lastLocationRef.current.lng}` : undefined;
          
          retakesCountRef.current += 1;

          onCapture({
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
          
          GenAiService.analyzeMultimodal(
              (type === 'audio' || type === 'video') ? mediaBlob : null, 
              allImageBlobs, 
              location
          ).then(result => {
              const { labels, aiInsight, isNatureSubject } = resolveNatureSubjectFields(result);
              updateSnapshot(snapId, {
                  aiInsight,
                  labels,
                  locationArea: result.location,
                  isAnalyzing: false,
                  isNatureSubject,
                  confidence: result.confidence,
                  isSensitiveSpecies: result.isSensitiveSpecies,
                  subjects: result.subjects,
                  aiProposedLabels: labels,
                  aiProposedBehavior: 'Analyzing... (from insight: ' + aiInsight.substring(0, 30) + '...)'
              });
              setIsProcessingCapture(false);
              showStatus('success', isNatureSubject ? 'Analysis complete. Saved to field notes.' : 'No nature subject detected in this capture.');
          }).catch(err => {
              console.error("Background analysis failed", err);
              updateSnapshot(snapId, { aiInsight: "Analysis failed.", isAnalyzing: false });
              setIsProcessingCapture(false);
              showStatus('error', 'Analysis failed. Please try again.');
          });
      };

      if (blobPromise) {
          blobPromise.then(compressedBlob => {
              finishCapture(compressedBlob, URL.createObjectURL(compressedBlob));
          });
      } else {
          finishCapture();
      }
      
      setIsRecordingAudio(false);
      setIsRecordingVideo(false);
      setRecordingTime(0);
    };

    recorder.start();
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
  }, [onCapture, userMode.userId, captureFrame]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleShutterPress = useCallback(() => {
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
                  setIsProcessingCapture(true);
                  showStatus('processing', 'Analyzing image...');
                  const location = lastLocationRef.current ? (lastLocationRef.current as any).name || `${lastLocationRef.current.lat},${lastLocationRef.current.lng}` : undefined;
                  
                  retakesCountRef.current += 1;
                  
                  onCapture({
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

                  GenAiService.analyzeMedia(compressedBlob, 'image', location).then(result => {
                      const { labels, aiInsight, isNatureSubject } = resolveNatureSubjectFields(result);
                      updateSnapshot(snapId, {
                          aiInsight,
                          labels,
                          locationArea: result.location,
                          isAnalyzing: false,
                          isNatureSubject,
                          confidence: result.confidence,
                          isSensitiveSpecies: result.isSensitiveSpecies,
                          subjects: result.subjects,
                          aiProposedLabels: labels,
                          aiProposedBehavior: 'Analyzing... (from insight: ' + aiInsight.substring(0, 30) + '...)'
                      });
                      setIsProcessingCapture(false);
                      showStatus('success', isNatureSubject ? 'Analysis complete. Saved to field notes.' : 'No nature subject detected in this capture.');
                  }).catch(err => {
                      console.error("Manual capture analysis failed", err);
                      updateSnapshot(snapId, { aiInsight: "Analysis failed.", isAnalyzing: false });
                      setIsProcessingCapture(false);
                      showStatus('error', 'Analysis failed. Please try again.');
                  });
              });
          }
      }
  }, [isCameraActive, isRecordingVideo, isRecordingAudio, stopRecording, captureFrame, onCapture, userMode.userId, lastAudioSnapshotId, lastAudioImages, updateSnapshot]);

  useEffect(() => {
    if (agentGainNodeRef.current && audioContext) {
      agentGainNodeRef.current.gain.setTargetAtTime(isMuted ? 0 : 1, audioContext.currentTime, 0.05);
    }
  }, [isMuted, audioContext]);

  const handleMicPress = useCallback(() => {
    micHoldTimeoutRef.current = window.setTimeout(() => {
        micHoldTimeoutRef.current = null;
        startRecording('audio');
    }, 500);
  }, [startRecording]);

  const handleMicRelease = useCallback(() => {
    let wasHold = false;
    if (micHoldTimeoutRef.current) {
        clearTimeout(micHoldTimeoutRef.current);
        micHoldTimeoutRef.current = null;
    } else {
        wasHold = true;
    }
    
    if (isRecordingAudio && wasHold) {
        stopRecording();
    } else if (!wasHold) {
        // Tap: Toggle Mute
        setIsMuted(prev => !prev);
    }
  }, [isRecordingAudio, stopRecording]);

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset immediately so selecting the same file again still fires
      // onChange, and so a second file can't be queued while one is in flight.
      e.target.value = '';
      if (!file || isProcessingCapture) return;

      setIsProcessingCapture(true);
      showStatus('processing', `Analyzing uploaded media...`);

      let prepared;
      try {
          prepared = await prepareUpload(file);
      } catch (err) {
          const message = err instanceof UploadValidationError ? err.message : "Couldn't process this file. Please try another.";
          showStatus('error', message);
          setIsProcessingCapture(false);
          return;
      }

      const snapId = Date.now().toString();
      const location = lastLocationRef.current ? (lastLocationRef.current as any).name || `${lastLocationRef.current.lat},${lastLocationRef.current.lng}` : undefined;

      retakesCountRef.current += 1;
      onCapture({
          id: snapId,
          ...prepared.snapshotFields,
          timestamp: new Date().toLocaleTimeString(),
          labels: ['Uploaded Discovery'],
          behavior: "Uploaded media.",
          aiInsight: "Processing...",
          userId: userMode.userId,
          isHybrid: false,
          location: location,
          isAnalyzing: true,
          rawLocation: lastLocationRef.current ? { lat: lastLocationRef.current.lat, lng: lastLocationRef.current.lng } : null,
          timeToRecordMs: Date.now() - sessionStartMsRef.current,
          sessionRetakes: retakesCountRef.current
      });

      analyzeUploadedMedia(prepared.analysisMedia, prepared.mediaType, location).then(result => {
          updateSnapshot(snapId, {
              aiInsight: result.aiInsight,
              labels: result.labels,
              locationArea: result.locationArea,
              isAnalyzing: false,
              isNatureSubject: result.isNatureSubject,
              isHybrid: result.isHybrid,
              confidence: result.confidence,
              isSensitiveSpecies: result.isSensitiveSpecies,
              subjects: result.subjects,
              aiProposedLabels: result.labels,
              aiProposedBehavior: 'Analyzing... (from insight: ' + result.aiInsight.substring(0, 30) + '...)'
          });
          setIsProcessingCapture(false);
          showStatus('success', result.isNatureSubject ? 'Upload analyzed. Saved to field notes.' : 'No nature subject detected in this upload.');
      }).catch(err => {
          console.error("Upload analysis failed", err);
          updateSnapshot(snapId, { aiInsight: "Analysis failed.", isAnalyzing: false });
          setIsProcessingCapture(false);
          showStatus('error', 'Analysis failed. Please try again.');
      });
  };

  const getStatusText = () => {
    if (agentState === 'FINALIZING') return "Archiving Field Data...";
    if (agentState === 'RECONNECTING') return "Lost Link - Syncing...";
    if (isCameraActive) {
        switch (agentState) {
            case 'BOOTING': return "Calibrating Visual Sensors...";
            case 'IDLE': return "Scanning Habitat...";
            case 'HEARING_USER': return isMuted ? "Observing (Muted)..." : "Observing & Listening...";
            case 'THINKING': return "Identifying Specimen...";
            case 'SPEAKING': return "Narrating Observation...";
            case 'DISCONNECTED': return "Offline - Tap to retry";
            default: return "Watching...";
        }
    } else {
        switch (agentState) {
            case 'BOOTING': return "Syncing Audio Uplink...";
            case 'IDLE': return "Listening to Wild...";
            case 'HEARING_USER': return isMuted ? "Muted" : "Listening...";
            case 'THINKING': return "Analyzing Calls...";
            case 'SPEAKING': return "Speaking...";
            case 'DISCONNECTED': return "Offline - Tap to retry";
            default: return "Standby";
        }
    }
  };

  const getPebbleStyle = () => {
    if (agentState === 'FINALIZING') return { color: "bg-theme-accent shadow-lg animate-pulse", icon: "save" };
    if (agentState === 'RECONNECTING') return { color: "bg-theme-accent animate-pulse", icon: "sync" };
    if (isCameraActive) {
        switch (agentState) {
            case 'BOOTING': return { color: "bg-theme-accent/40 border border-theme-accent/30", icon: "hourglass_empty" };
            case 'IDLE': return { color: "bg-theme-accent/40 animate-pulse-gentle", icon: "visibility" };
            case 'HEARING_USER': return { color: "bg-white text-theme-accent scale-110", icon: isMuted ? "mic_off" : "mic" };
            case 'THINKING': return { color: "bg-theme-accent animate-pulse", icon: "smart_toy" };
            case 'SPEAKING': return { color: "bg-theme-accent/80", icon: "record_voice_over" };
            case 'DISCONNECTED': return { color: "bg-red-500", icon: "wifi_off" };
            default: return { color: "bg-theme-accent/20", icon: "lens" };
        }
    } else {
        switch (agentState) {
            case 'BOOTING': return { color: "bg-theme-accent/40 border border-theme-accent/30", icon: "hourglass_empty" };
            case 'IDLE': return { color: isMuted ? "bg-white/10" : "bg-theme-accent/40", icon: isMuted ? "mic_off" : "mic_none" };
            case 'HEARING_USER': return { color: "bg-white text-theme-accent scale-110", icon: isMuted ? "mic_off" : "mic" };
            case 'THINKING': return { color: "bg-theme-accent animate-pulse", icon: "psychology" };
            case 'SPEAKING': return { color: "bg-theme-accent/80", icon: "volume_up" };
            case 'DISCONNECTED': return { color: "bg-red-500", icon: "wifi_off" };
            default: return { color: "bg-theme-accent/20", icon: "mic_off" };
        }
    }
  };

  const finalizeSession = useCallback(async (summary?: string) => {
    if (isFinalizingRef.current) return;
    isFinalizingRef.current = true;
    setAgentState('FINALIZING');
    const finalSummary = summary || "Exploration concluded.";
    if (naturalistId) {
      try {
        await FirebaseService.updateNaturalistMemory(naturalistId, { lastSessionSummary: finalSummary });
      } catch (e) {
        console.warn("Failed to update naturalist memory, proceeding to end session anyway:", e);
      }
    }
    setTimeout(() => onEndSession(finalSummary), 1200);
  }, [naturalistId, onEndSession]);

  // initSession's own callback closure is recreated far less often than
  // finalizeSession (which changes whenever naturalistId updates, e.g.
  // right after a session starts), so the idle-check interval below reads
  // through this ref instead of calling finalizeSession directly — that
  // way it always finalizes with the current naturalistId, not whatever
  // was set when initSession's closure was created.
  const finalizeSessionRef = useRef(finalizeSession);
  useEffect(() => { finalizeSessionRef.current = finalizeSession; }, [finalizeSession]);

  useEffect(() => { if (isFinalizing && agentState !== 'FINALIZING') finalizeSession(); }, [isFinalizing, agentState, finalizeSession]);

  const addToChat = useCallback((role: 'user' | 'assistant' | 'system', text: string, links?: GroundingLink[]) => {
    if (role === 'user' || role === 'assistant') lastActivityAtRef.current = Date.now();
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
        
        if (settings.torch !== undefined && (supported as any).torch) {
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

        let stream: MediaStream | null = null;
        try {
            // 1. Try preferred settings (Requested Mode + Audio Processing)
            // Note: Removed sampleRate constraint as it causes failures on some hardware.
            // Web Audio API will handle resampling later.
            stream = await getMedia({
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
        } catch (permErr: any) {
            // The combined video+audio request was denied outright. Before
            // giving up on the whole session, check whether the camera
            // alone is still usable — a lot of the app (capture, framing)
            // works fine without a microphone; only the agent's ability to
            // hear the user is lost. This distinguishes "mic blocked" from
            // "camera blocked" instead of failing the same way for both.
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
            } catch {
                throw new Error("CAMERA_PERMISSION_DENIED");
            }
        }

        if (!stream) {
            throw new Error("Could not start media stream. Please ensure camera/microphone permissions are granted.");
        }

        activeStreamRef.current = stream;
        const noMic = stream.getAudioTracks().length === 0;
        if (noMic && !micUnavailableRef.current) {
            showStatus('error', "Microphone unavailable — the agent can see but won't hear you. Enable mic access in your browser settings to talk with it.");
        }
        micUnavailableRef.current = noMic;
        setMicUnavailable(noMic);
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
            
            setHasTorch(!!caps.torch || (supportedConstraintsRef.current as any).torch);
            
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

        return stream;
    } catch (err) {
        console.error("Failed to start stream", err);
        throw err;
    }
  }, []);

  const switchCameraMode = useCallback(async (mode: 'user' | 'environment') => {
      setFacingMode(mode);
      await startMediaStream(mode);
  }, [startMediaStream]);

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
            facing_mode: facingMode,
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
        await switchCameraMode(args.facing_mode);
        return { result: `Switched to ${args.facing_mode} camera.` };
    }
    if (name === 'end_session') { finalizeSession(args.summary); return { result: "ok" }; }
    if (name === 'set_camera_state') { setIsCameraActive(args.is_active); return { result: "ok" }; }
    if (name === 'trigger_capture') {
      if (!isCameraActiveRef.current) return { error: "Camera is off." };
      const res = captureFrame(true);
      if (res && res.blobPromise) {
        res.blobPromise.then(compressedBlob => {
           const objUrl = URL.createObjectURL(compressedBlob);
           // Defense in depth: even though the prompt/schema instruct the
           // model not to invent a natural reading when is_nature_subject
           // is false, don't trust free-text labels/insight in that case —
           // override with an honest, fixed message rather than whatever
           // the model happened to emit.
           const isNatureSubject = args.is_nature_subject !== false;
           const resolvedLabels = isNatureSubject
               ? normalizeLabels(args.labels || (args.label ? [args.label] : ['Nature']))
               : ['No Nature Subject Detected'];
           const resolvedBehavior = isNatureSubject
               ? (args.behavior || "Manual observation captured by explorer.")
               : "No plant, animal, or fungus detected in this frame.";
           const resolvedAiInsight = isNatureSubject
               ? (args.ai_insight || "Visual record for field study.")
               : "This capture doesn't appear to contain a natural subject.";

           retakesCountRef.current += 1;

           onCapture({
               id: Date.now().toString(),
               url: objUrl,
               blob: compressedBlob,
               timestamp: new Date().toLocaleTimeString(),
               labels: resolvedLabels,
               behavior: resolvedBehavior,
               aiInsight: resolvedAiInsight,
               type: 'image',
               userId: userMode.userId,
               isHybrid: args.is_hybrid,
               isNatureSubject,
               confidence: args.confidence,
               isSensitiveSpecies: args.is_sensitive_species,
               subjects: args.subjects,
               location: lastLocationRef.current ? (lastLocationRef.current as any).name || `${lastLocationRef.current.lat},${lastLocationRef.current.lng}` : undefined,
               rawLocation: lastLocationRef.current ? { lat: lastLocationRef.current.lat, lng: lastLocationRef.current.lng } : null,
               timeToRecordMs: Date.now() - sessionStartMsRef.current,
               sessionRetakes: retakesCountRef.current
           });

           // Push sighting overlay on screen
           setLatestSighting({
               labels: resolvedLabels,
               behavior: resolvedBehavior,
               aiInsight: resolvedAiInsight
           });
        });
        return { result: "ok" };
      }
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
        locationWatchIdRef.current = navigator.geolocation.watchPosition(
            async (position) => {
                let locationString = `${position.coords.latitude},${position.coords.longitude}`;
                try {
                    // Use OpenStreetMap Nominatim API
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=10&addressdetails=1`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.address) {
                            locationString = data.address.city || data.address.town || data.address.village || data.address.county || data.address.state || locationString;
                        }
                    }
                } catch (e) {
                    console.warn("Geocoding failed, falling back to coordinates", e);
                }
                
                const coords = { lat: position.coords.latitude, lng: position.coords.longitude, name: locationString };
                lastLocationRef.current = coords;
                if (geminiServiceRef.current) geminiServiceRef.current.setLocation(coords.lat, coords.lng);
            },
            undefined,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }
    return () => { if (locationWatchIdRef.current !== null) navigator.geolocation.clearWatch(locationWatchIdRef.current); };
  }, [hasSelectedMode]);

  const configModel = config?.model;
  const configSysInstruction = config?.systemInstruction;
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
      let idleCheckInterval: number | null = null;

      lastActivityAtRef.current = Date.now();
      isFinalizingRef.current = false;

      try {
        console.debug("initSession starting...");
        if (audioContext.state === 'suspended') {
            console.debug("Resuming audioContext...");
            await audioContext.resume();
        }
        const nId = userIdValue || await FingerprintService.getFingerprint();
        setNaturalistId(nId);
        const memory = await FirebaseService.getNaturalistMemory(nId);
        
        console.debug("Starting media stream...");
        const stream = await startMediaStream('environment');
        console.debug("Media stream started.");

        const service = new GeminiLiveService(audioContext, {
            onAudioData: playAudioData,
            onInterrupted: () => { stopAllAudio(); if(agentState !== 'FINALIZING') setAgentState('HEARING_USER'); },
            onTranscript: (text, isUser, links) => addToChat(isUser ? 'user' : 'assistant', text, links),
            onTurnComplete: () => { setLiveCaption(""); },
            onToolCall: handleToolCall,
            onConnectionStateChange: (state) => { 
                console.debug("Connection state changed:", state);
                if (agentState === 'FINALIZING') return;
                switch (state) {
                    case 'CONNECTED': setAgentState('IDLE'); break;
                    case 'RECONNECTING': setAgentState('RECONNECTING'); break;
                    case 'DISCONNECTED': setAgentState('DISCONNECTED'); break;
                }
            },
            onError: (err) => {
                console.error("GeminiLiveService error delegate:", err);
                const errMsg = err?.message || String(err);
                if (errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED")) {
                    setSessionError("API Key Referrer Blocked: Please update your Google Cloud Console API key restrictions to allow 'https://aistudio.google.com/*' and 'https://*.run.app/*'. Also ensure empty referrers are allowed for WebSockets.");
                } else if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("429") || errMsg.toLowerCase().includes("quota")) {
                    setSessionError("You've reached today's usage limit for the Live Guide. Please try again in a little while.");
                }
            }
        });

        const memoryContext = memory ? `[NATURALIST PROFILE: ${memory.preferredStyle}. Last summary: ${memory.lastSessionSummary}]` : '';
        
        const modeInstruction = selectedMode === 'observation' 
            ? "\n[MODE: OBSERVATION. You are a silent observer. IMPORTANT: The user will NOT hear your voice; they will only see your text transcripts. Keep your responses very brief, scientific, and focused. Do not speak unless necessary. When you do respond, provide concise text-based insights.]"
            : "\n[MODE: CONVERSATION. You are an active field companion. Engage in real-time dialogue, ask questions, and be highly interactive. Your goal is to be a conversational partner in this exploration.]";

        service.setSystemInstruction(memoryContext + "\n" + (configSysInstruction || "") + modeInstruction);
        service.setModel(configModel || "");
        if (lastLocationRef.current) service.setLocation(lastLocationRef.current.lat, lastLocationRef.current.lng);
        
        console.debug("Connecting service...");
        service.connect(); // Do not await to avoid blocking initialization if connection hangs
        geminiServiceRef.current = service;

        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        inputCtx = new AudioContextClass({ sampleRate: 16000 });
        if (inputCtx.state === 'suspended') {
            console.debug("Resuming inputCtx...");
            await inputCtx.resume();
        }
        
        // createMediaStreamSource throws on a track-less stream, so only
        // wire up the mic-input graph when a microphone was actually
        // granted — a camera-only stream (mic denied/unavailable) still
        // runs the session, just without the agent hearing the user.
        if (stream.getAudioTracks().length > 0) {
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
            processor.onaudioprocess = (e) => {
                if (geminiServiceRef.current && geminiServiceRef.current.isConnected()) {
                    service.sendAudioChunk(e.inputBuffer.getChannelData(0));
                }
            };
            agentGainNode.connect(processor);
            processor.connect(inputCtx.destination);
        }

        videoInterval = window.setInterval(() => {
             if (isCameraActiveRef.current && geminiServiceRef.current && geminiServiceRef.current.isConnected()) {
                 const res = captureFrame(false);
                 if (res && canvasRef.current && shouldSendStreamingFrame(canvasRef.current)) {
                     service.sendVideoFrame(res.dataUrl);
                 }
             }
        }, 1000);

        idleCheckInterval = window.setInterval(() => {
            if (isFinalizingRef.current) return;
            const idleMs = Date.now() - lastActivityAtRef.current;
            if (idleMs >= IDLE_SESSION_TIMEOUT_MS) {
                console.debug(`[LiveLens] Ending session after ${Math.round(idleMs / 1000)}s of inactivity`);
                finalizeSessionRef.current("Session ended automatically after a period of inactivity.");
                return;
            }
            // The idle timeout alone doesn't cap a genuinely active session:
            // the server's 3-minute-per-connection cap (geminiProxy.js) is
            // invisible to the user because GeminiLiveService just
            // reconnects and continues — an engaged user talking/capturing
            // continuously could otherwise run (and bill) indefinitely.
            const sessionMs = Date.now() - sessionStartMsRef.current;
            if (sessionMs >= MAX_SESSION_DURATION_MS) {
                console.debug(`[LiveLens] Ending session after reaching max duration (${Math.round(sessionMs / 60000)}min)`);
                finalizeSessionRef.current("Session ended automatically after reaching its maximum length. Start a new expedition to keep exploring.");
            }
        }, 5000);

        console.debug("initSession complete.");
        return () => {
            console.debug("initSession cleanup...");
            if (geminiServiceRef.current) {
                geminiServiceRef.current.disconnect();
                geminiServiceRef.current = null;
            }
            if (videoInterval) clearInterval(videoInterval);
            if (idleCheckInterval) clearInterval(idleCheckInterval);
            if (processor) processor.disconnect();
            if (inputCtx) inputCtx.close();
            if (activeStreamRef.current) activeStreamRef.current.getTracks().forEach(t => t.stop());
        };
      } catch (err) {
          console.error("Session init failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg === "CAMERA_PERMISSION_DENIED") {
              setSessionError("Camera access is required for the Live Lens. Please allow camera permissions for this site in your browser settings, then retry.");
          }
          setAgentState('DISCONNECTED');
          return () => {
              if (geminiServiceRef.current) {
                  geminiServiceRef.current.disconnect();
                  geminiServiceRef.current = null;
              }
              if (videoInterval) clearInterval(videoInterval);
              if (idleCheckInterval) clearInterval(idleCheckInterval);
              if (processor) processor.disconnect();
              if (inputCtx) inputCtx.close();
          };
      }
  }, [audioContext, isTourActive, hasSelectedMode, configModel, configSysInstruction, userIdValue]);

  const cleanupRef = useRef<(() => void) | null>(null);

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
      <div className={`absolute inset-0 bg-white z-[100] transition-opacity duration-150 pointer-events-none ${isFlashing ? 'opacity-100' : 'opacity-0'}`} />

      <button onClick={() => {
          if (isProcessingCapture) {
              alert("Please wait while the ecological analysis is finalized.");
              return;
          }
          finalizeSession();
      }} className="absolute top-10 right-6 z-[120] w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white flex items-center justify-center active:scale-90 transition-transform shadow-lg"><span className="material-symbols-outlined">close</span></button>

      <button
          onClick={() => setShowHelpSheet(true)}
          aria-label="What can I ask or do?"
          title="What can I ask or do?"
          className="absolute top-10 left-6 z-[120] w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white flex items-center justify-center active:scale-90 transition-transform shadow-lg"
      >
          <span className="material-symbols-outlined">help</span>
      </button>

      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-[120] pointer-events-auto flex flex-col items-center gap-2">
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
                  className={`bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-xl flex items-center gap-2 transition-all duration-300 animate-in fade-in slide-in-from-top-4 ${agentState === 'DISCONNECTED' ? 'active:scale-95 cursor-pointer border-red-500/50' : 'cursor-default'} ${agentState === 'THINKING' || agentState === 'RECONNECTING' ? 'animate-pulse' : ''}`}
              >
                  <span className={`material-symbols-outlined text-[12px] text-white/90 ${(agentState === 'RECONNECTING' || agentState === 'BOOTING') ? 'animate-spin' : ''} ${agentState === 'DISCONNECTED' ? 'text-red-500' : ''}`}>
                      {getPebbleStyle().icon === 'sync' ? 'autorenew' : getPebbleStyle().icon}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${agentState === 'DISCONNECTED' ? 'text-red-100' : 'text-white/90'}`}>
                      {getStatusText()}
                  </span>
              </button>
          )}

          {analysisStatus && (
              <div className={`bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-xl flex items-center gap-2 transition-all duration-300 animate-in fade-in slide-in-from-top-4 ${analysisStatus.type === 'processing' ? 'animate-pulse' : ''} ${analysisStatus.type === 'error' ? 'border-red-500/50' : analysisStatus.type === 'success' ? 'border-green-500/50' : ''}`}>
                  <span className={`material-symbols-outlined text-[12px] ${analysisStatus.type === 'processing' ? 'animate-spin text-white/90' : analysisStatus.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                      {analysisStatus.type === 'processing' ? 'autorenew' : 
                       analysisStatus.type === 'success' ? 'check_circle' : 'error'}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${analysisStatus.type === 'success' ? 'text-green-100' : analysisStatus.type === 'error' ? 'text-red-100' : 'text-white/90'}`}>
                      {analysisStatus.text}
                  </span>
              </div>
          )}
      </div>

      {sessionError && (
          <div className="absolute inset-0 z-[110] bg-black/90 backdrop-blur-3xl flex flex-col items-center justify-center p-8 text-center pointer-events-auto">
              <span className="material-symbols-outlined text-red-500 text-6xl mb-4">error</span>
              <h2 className="text-2xl font-display font-black text-white mb-4">Connection Blocked</h2>
              <p className="text-sm text-white/80 mb-8 max-w-md leading-relaxed">{sessionError}</p>
               <div className="flex gap-4">
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
                      className="px-6 py-3 bg-theme-accent text-white rounded-full font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform"
                  >
                      Retry Connection
                  </button>
                  <button 
                      onClick={() => setSessionError(null)}
                      className="px-6 py-3 bg-white/10 text-white rounded-full font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform"
                  >
                      Dismiss
                  </button>
              </div>
          </div>
      )}

      {agentState === 'FINALIZING' && (
          <div className="absolute inset-0 z-[100] bg-black/90 backdrop-blur-3xl flex flex-col items-center justify-center p-8 text-center">
              <div className="w-20 h-20 rounded-full border-4 border-theme-accent border-t-transparent animate-spin mb-8"></div>
              <h2 className="text-3xl font-display font-black italic text-white mb-2">Archiving Discovery...</h2>
          </div>
      )}

      {showHelpSheet && (
          <div className="absolute inset-0 z-[220] flex items-end sm:items-center justify-center p-4 animate-fade-in pointer-events-auto">
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowHelpSheet(false)}></div>
              <div className="relative w-full max-w-sm bg-white rounded-[2rem] shadow-2xl overflow-hidden max-h-[80vh] overflow-y-auto">
                  <div className="p-7">
                      <h3 className="text-xl font-display font-black italic text-stone-900 mb-1">What Can I Ask or Do?</h3>
                      <p className="text-xs text-stone-500 mb-5 uppercase tracking-widest font-bold">Field Guide Cheat Sheet</p>

                      <div className="space-y-4 text-sm text-stone-700">
                          <div className="flex gap-3">
                              <span className="material-symbols-outlined text-theme-accent shrink-0">zoom_in</span>
                              <p><b>"Zoom in on that."</b> The agent can adjust zoom, exposure, and switch between front/back cameras for you — just ask.</p>
                          </div>
                          <div className="flex gap-3">
                              <span className="material-symbols-outlined text-theme-accent shrink-0">flashlight_on</span>
                              <p><b>"Turn on the torch."</b> Works for low light, if your device supports it.</p>
                          </div>
                          <div className="flex gap-3">
                              <span className="material-symbols-outlined text-theme-accent shrink-0">camera</span>
                              <p><b>Tap the shutter</b> for a photo. <b>Hold it</b> to record up to 30s of video.</p>
                          </div>
                          <div className="flex gap-3">
                              <span className="material-symbols-outlined text-theme-accent shrink-0">mic</span>
                              <p><b>Hold the mic</b> for an audio-only recording. Tap it to mute/unmute your voice to the agent.</p>
                          </div>
                          <div className="flex gap-3">
                              <span className="material-symbols-outlined text-theme-accent shrink-0">upload_file</span>
                              <p><b>Already have media?</b> Use the upload button — no camera needed.</p>
                          </div>
                          <div className="flex gap-3">
                              <span className="material-symbols-outlined text-theme-accent shrink-0">shield</span>
                              <p>The agent won't offer edibility or toxicity guidance for anything it identifies — misidentification is genuinely dangerous, so it always sticks to biology and ID.</p>
                          </div>
                      </div>

                      <button
                          onClick={() => { setShowHelpSheet(false); setShowTourReplay(true); }}
                          className="mt-6 w-full py-3.5 rounded-2xl border-2 border-theme-accent/30 text-theme-accent font-black text-xs uppercase tracking-widest active:scale-95 transition-transform flex items-center justify-center gap-2"
                      >
                          <span className="material-symbols-outlined text-lg">replay</span>
                          Replay Welcome Tour
                      </button>
                      <button
                          onClick={() => setShowHelpSheet(false)}
                          className="mt-3 w-full py-4 rounded-2xl bg-theme-accent text-white font-black text-xs uppercase tracking-widest active:scale-95 transition-transform"
                      >
                          Got It
                      </button>
                  </div>
              </div>
          </div>
      )}

      <OnboardingTour onComplete={() => setIsTourActive(false)} />
      {showTourReplay && (
          <OnboardingTour forceShow onComplete={() => setShowTourReplay(false)} />
      )}

      {/* Sighting Insight Overlay Text Blob */}
      <AnimatePresence>
          {latestSighting && (
              <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 30 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 30 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                  className="absolute bottom-40 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-sm bg-stone-900/95 backdrop-blur-xl p-6 rounded-[2rem] border border-white/10 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] z-[85] pointer-events-auto flex flex-col gap-3"
              >
                  {/* Close Button */}
                  <button 
                      onClick={() => setLatestSighting(null)} 
                      className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all duration-300 pointer-events-auto"
                  >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>

                  {/* Header labels */}
                  <div className="flex flex-wrap gap-1.5 pr-8">
                      {latestSighting.labels.map((label, idx) => (
                          <span key={idx} className="bg-theme-accent/20 border border-theme-accent/30 text-theme-accent font-sans px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase animate-fade-in">
                              {label}
                          </span>
                      ))}
                  </div>

                  {/* Behavior text */}
                  {latestSighting.behavior && (
                      <p className="text-xs text-white/55 italic leading-snug">
                          {latestSighting.behavior}
                      </p>
                  )}

                  {/* Ecological Insight detail */}
                  <div className="border-t border-white/15 pt-3">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-theme-accent mb-1.5">Ecological Insight</p>
                      <p className="text-xs font-medium text-white/90 leading-relaxed max-h-48 overflow-y-auto no-scrollbar">
                          {latestSighting.aiInsight}
                      </p>
                  </div>

                  {/* Auto Dismiss Progress Lifebar */}
                  <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden mt-1 shrink-0">
                      <motion.div 
                          initial={{ width: "100%" }}
                          animate={{ width: "0%" }}
                          transition={{ duration: 15, ease: "linear" }}
                          className="bg-theme-accent h-full w-full"
                      />
                  </div>
              </motion.div>
          )}
      </AnimatePresence>

      <div className="absolute inset-0 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${isCameraActive ? 'opacity-100 scale-105' : 'opacity-40 blur-[60px]'}`} />
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {aiOpticActive && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] animate-bounce">
              <div className="bg-theme-accent/90 backdrop-blur-md px-5 py-2 rounded-full border border-theme-accent/50 shadow-xl flex items-center gap-2">
                  <span className="material-symbols-outlined text-[10px] text-white animate-spin">sync</span>
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">AI Sync Active</span>
              </div>
          </div>
      )}

      {isCameraActive && canZoom && (
          <div className="absolute right-6 top-1/2 -translate-y-1/2 z-[50] flex flex-col items-center gap-4 bg-black/30 backdrop-blur-2xl p-4 rounded-full border border-white/20 shadow-2xl">
              <button onClick={() => applyOpticalSettings({ zoom: zoom + 0.5 })} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white active:scale-90 active:bg-theme-accent transition-all"><span className="material-symbols-outlined">add</span></button>
              <div className="relative h-48 w-2 bg-white/10 rounded-full overflow-hidden group cursor-pointer flex flex-col justify-end">
                  <input type="range" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step} value={zoom} onChange={(e) => applyOpticalSettings({ zoom: parseFloat(e.target.value) })} className="absolute inset-0 w-48 h-2 opacity-0 cursor-pointer origin-center -rotate-90 translate-y-24" style={{ transform: 'rotate(-90deg) translateX(-96px)' }} />
                  <div className="w-full bg-theme-accent transition-all duration-300" style={{ height: `${((zoom - zoomRange.min) / (zoomRange.max - zoomRange.min)) * 100}%` }} />
              </div>
              <button onClick={() => applyOpticalSettings({ zoom: zoom - 0.5 })} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white active:scale-90 active:bg-theme-accent transition-all"><span className="material-symbols-outlined">remove</span></button>
              <div className="text-center">
                  <span className="text-[8px] font-mono font-black text-white block opacity-60">ZOOM</span>
                  <span className="text-[10px] font-mono font-black text-white block">{zoom.toFixed(1)}x</span>
              </div>
          </div>
      )}

      {isCameraActive && (
          <div className="absolute left-6 top-32 z-50 flex flex-col gap-6">
              {hasTorch && (
                <button onClick={() => applyOpticalSettings({ torch: !torch })} className={`w-14 h-14 rounded-full backdrop-blur-xl border transition-all flex flex-col items-center justify-center gap-1 shadow-2xl ${torch ? 'bg-theme-accent border-theme-accent/50 text-white scale-110' : 'bg-black/30 border-white/10 text-white/40'}`}>
                    <span className="material-symbols-outlined text-xl">{torch ? 'flashlight_on' : 'flashlight_off'}</span>
                    <span className="text-[7px] font-black uppercase tracking-tighter">Torch</span>
                </button>
              )}
              <button onClick={() => switchCameraMode(facingMode === 'environment' ? 'user' : 'environment')} className="w-14 h-14 rounded-full backdrop-blur-xl border border-white/20 text-white/40 flex flex-col items-center justify-center gap-1 bg-black/40 transition-all active:scale-95 shadow-2xl">
                  <span className="material-symbols-outlined text-xl">cached</span>
                  <span className="text-[7px] font-black uppercase tracking-tighter">Flip</span>
              </button>
              
              <label className={`w-14 h-14 rounded-full backdrop-blur-xl border border-white/20 text-white/40 flex flex-col items-center justify-center gap-1 bg-black/40 transition-all shadow-2xl ${isProcessingCapture ? 'opacity-40' : 'active:scale-95 cursor-pointer'}`}>
                  <span className="material-symbols-outlined text-xl">upload_file</span>
                  <span className="text-[7px] font-black uppercase tracking-tighter">Upload</span>
                  <input type="file" accept="image/*,video/*,audio/*" className="hidden" disabled={isProcessingCapture} onChange={handleMediaUpload} />
              </label>
          </div>
      )}



      <div className="flex-1 flex flex-col justify-end items-center pointer-events-none relative z-20 pb-20">
          <AudioVisualizer isActive={agentState === 'SPEAKING' || (isCameraActive && agentState === 'IDLE')} color="bg-theme-accent" />
          <div className="mt-8 px-10 text-center">
              {liveCaption && (
                  <div className="animate-fade-in bg-black/40 backdrop-blur-2xl px-8 py-5 rounded-[2.5rem] border border-white/10 max-w-sm mx-auto shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                      <p className={`text-[9px] font-black uppercase tracking-[0.3em] mb-2 text-theme-accent`}>Field Guide Transcription</p>
                      <p className="text-xl font-display italic font-medium text-white leading-tight">"{liveCaption}"</p>
                  </div>
              )}
          </div>
      </div>

      <div className="relative z-40 p-8 pt-0 safe-pb">
          {showModalityTooltip && (
              <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-[60] w-full max-w-xs animate-slide-up pointer-events-auto">
                  <div className="bg-theme-accent text-white p-6 rounded-3xl shadow-2xl relative">
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-4 h-4 bg-theme-accent rotate-45" />
                      <h4 className="font-display font-black italic text-lg mb-2">Multi-Modal Mastery</h4>
                      <p className="text-xs leading-relaxed opacity-90 mb-4">
                          Capture <b>Video</b> for sight & sound. Tap the shutter during any recording to add <b>Key Frames</b>. The agent will analyze them as one unified observation.
                      </p>
                      <div className="flex justify-end gap-3">
                          <button 
                            onClick={() => {
                                setShowModalityTooltip(false);
                                localStorage.setItem('naturegram_has_seen_modality_tooltip', 'true');
                            }} 
                            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors"
                          >
                            Skip
                          </button>
                          <button 
                            onClick={() => {
                                setShowModalityTooltip(false);
                                localStorage.setItem('naturegram_has_seen_modality_tooltip', 'true');
                            }} 
                            className="px-4 py-2 bg-white text-theme-accent rounded-full text-[10px] font-black uppercase tracking-widest transition-colors"
                          >
                            Got it
                          </button>
                      </div>
                  </div>
              </div>
          )}
          <div className="flex items-center justify-between max-w-md mx-auto pointer-events-auto">
              <div className="w-14 h-14" />
              
              <div className="flex items-center gap-8">
                  <div className="flex flex-col items-center gap-2">
                      <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
                          {micUnavailable ? "No Mic" : (isRecordingAudio ? "Recording..." : (isMuted ? "Muted" : "Listening"))}
                      </span>
                      <button
                        onPointerDown={handleMicPress}
                        onPointerUp={handleMicRelease}
                        onPointerLeave={handleMicRelease}
                        disabled={isProcessingCapture || micUnavailable}
                        title={micUnavailable ? "Microphone unavailable" : undefined}
                        className={`w-14 h-14 rounded-full backdrop-blur-xl border flex flex-col items-center justify-center transition-all shadow-2xl touch-none ${isRecordingAudio ? 'bg-red-500/20 border-red-500 text-red-500 animate-pulse' : (isMuted || micUnavailable ? 'bg-white/5 border-white/10 text-white/20' : 'bg-theme-accent/20 border-theme-accent/30 text-theme-accent active:scale-95')} ${isProcessingCapture || micUnavailable ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                          <span className="material-symbols-outlined">{isRecordingAudio ? 'stop_circle' : (isMuted || micUnavailable ? 'mic_off' : 'mic')}</span>
                          {isRecordingAudio && <span className="text-[8px] font-black">{recordingTime}s</span>}
                      </button>
                      <span className="text-[8px] font-bold text-white/30 uppercase tracking-tighter">{micUnavailable ? "Camera only" : "Tap: Mute • Hold: Rec"}</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 relative">
                      {lastAudioSnapshotId && !isRecordingAudio && !isRecordingVideo && (
                          <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-[60] w-48 animate-bounce pointer-events-none">
                              <div className="bg-theme-accent text-white p-3 rounded-2xl shadow-xl relative text-center">
                                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 bg-theme-accent rotate-45" />
                                  <p className="text-[10px] font-black uppercase tracking-widest leading-tight">
                                      Add a photo cover for your audio
                                  </p>
                              </div>
                          </div>
                      )}
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/50 bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
                          {isCameraActive ? "Tap: Photo • Hold: Video" : "Tap to activate camera"}
                      </span>
                      <button 
                          onPointerDown={handleShutterPress}
                          onPointerUp={handleShutterRelease}
                          onPointerLeave={handleShutterRelease}
                          disabled={isProcessingCapture}
                          className={`group relative w-24 h-24 flex items-center justify-center active:scale-90 transition-all touch-none ${isProcessingCapture ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                          <div className={`absolute inset-0 rounded-full border-4 transition-all duration-500 ${isCameraActive ? 'border-theme-accent scale-110 opacity-60' : 'border-white/10'} ${isRecordingVideo ? 'border-red-500 animate-pulse' : ''}`} />
                          
                          {isRecordingVideo && (
                              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                                  <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(239, 68, 68, 0.2)" strokeWidth="8" />
                                  <circle cx="50" cy="50" r="46" fill="none" stroke="#ef4444" strokeWidth="8" strokeDasharray="289" strokeDashoffset={289 - (289 * (30 - recordingTime) / 30)} className="transition-all duration-1000 ease-linear" />
                              </svg>
                          )}

                          <div className={`w-20 h-20 rounded-full shadow-[0_0_30px_rgba(255,165,0,0.3)] flex items-center justify-center transition-all ${isCameraActive ? 'bg-white' : 'bg-white/10 border border-white/20'} ${isRecordingVideo ? 'bg-red-500' : ''}`}>
                              <span className={`material-symbols-outlined text-4xl transition-colors ${isCameraActive ? 'text-theme-accent' : 'text-theme-accent/60'} ${isRecordingVideo ? 'text-white' : ''}`}>
                                  {isRecordingVideo ? 'videocam' : (isCameraActive ? 'photo_camera' : 'sensors')}
                              </span>
                          </div>
                      </button>
                  </div>
                  <button onClick={() => setIsCameraActive(!isCameraActive)} className={`w-14 h-14 rounded-full backdrop-blur-xl border flex items-center justify-center transition-all ${isCameraActive ? 'bg-theme-accent/20 border-theme-accent text-theme-accent' : 'bg-white/5 border-white/10 text-theme-accent/30'}`}>
                      <span className="material-symbols-outlined">{isCameraActive ? 'visibility' : 'visibility_off'}</span>
                  </button>
              </div>
              <div className="w-14 h-14" />
          </div>
      </div>
    </div>
  );
};

export default LiveLens;
