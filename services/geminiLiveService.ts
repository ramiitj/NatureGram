
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { tools } from "../constants";
import { floatTo16BitPCM, arrayBufferToBase64, decodeAudioData, base64ToArrayBuffer } from "./audioUtils";
import { GroundingLink } from "../types";
import { auth } from "../firebaseConfig";

// Errors worth giving up on immediately rather than burning through the
// bounded reconnect attempts: a blocked API key or an exhausted quota won't
// resolve itself by retrying, so retrying just delays a message the user
// actually needs to see.
const isFatalLiveError = (errMsg: string): boolean =>
    errMsg.includes("referer") ||
    errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") ||
    errMsg.includes("403") ||
    errMsg.includes("RESOURCE_EXHAUSTED") ||
    errMsg.includes("429") ||
    errMsg.toLowerCase().includes("quota");

interface GeminiLiveDelegate {
  onAudioData: (audioBuffer: AudioBuffer) => void;
  onInterrupted?: () => void;
  onTranscript?: (text: string, isUser: boolean, groundingLinks?: GroundingLink[]) => void;
  onToolCall?: (name: string, args: any) => Promise<any>;
  onConnectionStateChange?: (state: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING') => void;
  onError?: (error: any) => void;
  onTurnComplete?: () => void;
  // Fired once, from disconnect() (a genuine session end — never on an
  // internal reconnect), with this session's accumulated performance
  // metrics (see R1: "you can't optimize or pitch the real-time experience
  // without measuring it").
  onSessionMetrics?: (metrics: LiveSessionMetrics) => void;
}

export interface LiveSessionMetrics {
  // Wall-clock time from connect() to the first audio/transcript chunk of
  // the model's very first response this session. Null if the session
  // never got a single response (e.g. connection failed outright).
  timeToFirstTokenMs: number | null;
  // One entry per model turn after the first: time from the previous
  // turn's completion to this turn's first response chunk. Excludes the
  // very first turn (that's timeToFirstTokenMs, measured from connect
  // rather than from a prior turnComplete).
  turnLatenciesMs: number[];
  toolCallCounts: Record<string, number>;
  reconnectCount: number;
}

export class GeminiLiveService {
  private sessionPromise: Promise<any> | null = null;
  private delegate: GeminiLiveDelegate;
  private outputAudioContext: AudioContext;
  private connected = false;
  private isManuallyClosed = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeoutId: any = null;
  
  private systemInstruction: string = '';
  private model: string = 'models/gemini-2.5-flash-native-audio-latest';
  private latLng: { latitude: number, longitude: number } | null = null;

  private currentModelTurnText: string = "";
  private currentUserTurnText: string = "";

  // R1: Live-session instrumentation (see LiveSessionMetrics doc comments).
  private connectStartedAt: number | null = null;
  private firstTokenReceived = false;
  private turnResponseStarted = false;
  private lastTurnCompleteAt: number | null = null;
  private metrics: LiveSessionMetrics = { timeToFirstTokenMs: null, turnLatenciesMs: [], toolCallCounts: {}, reconnectCount: 0 };

  constructor(audioContext: AudioContext, delegate: GeminiLiveDelegate) {
    this.delegate = delegate;
    this.outputAudioContext = audioContext;
  }

  // A defensive copy so callers can't mutate the service's live-tracked
  // arrays/objects out from under it.
  public getSessionMetrics(): LiveSessionMetrics {
    return {
      ...this.metrics,
      turnLatenciesMs: [...this.metrics.turnLatenciesMs],
      toolCallCounts: { ...this.metrics.toolCallCounts },
    };
  }

  // Marks the first response chunk of a model turn — called from both the
  // audio and output-transcript branches of handleMessage, since either
  // can arrive first. Idempotent per turn (guarded by turnResponseStarted,
  // reset on turnComplete).
  private markTurnResponseStart() {
    if (this.turnResponseStarted) return;
    this.turnResponseStarted = true;

    if (!this.firstTokenReceived) {
      this.firstTokenReceived = true;
      this.metrics.timeToFirstTokenMs = this.connectStartedAt !== null ? Date.now() - this.connectStartedAt : null;
    } else if (this.lastTurnCompleteAt !== null) {
      this.metrics.turnLatenciesMs.push(Date.now() - this.lastTurnCompleteAt);
    }
  }

  public isConnected() {
    return this.connected;
  }

  public updateDelegate(newDelegate: Partial<GeminiLiveDelegate>) {
    this.delegate = { ...this.delegate, ...newDelegate };
  }

  public setLocation(lat: number, lng: number) {
    this.latLng = { latitude: lat, longitude: lng };
  }

  public setSystemInstruction(instruction: string) {
    this.systemInstruction = instruction;
  }

  public setModel(model: string) {
    this.model = model;
  }

  public async connect() {
    this.isManuallyClosed = false;
    this.connectStartedAt = Date.now();
    this.firstTokenReceived = false;
    this.turnResponseStarted = false;
    this.lastTurnCompleteAt = null;
    this.metrics = { timeToFirstTokenMs: null, turnLatenciesMs: [], toolCallCounts: {}, reconnectCount: 0 };
    await this.internalConnect();
  }

  private async internalConnect() {
    try {
      // Use Firebase Auth token as the key for the proxy to verify
      let apiKey = "PROXY";
      if (auth.currentUser) {
          apiKey = await auth.currentUser.getIdToken();
      }

      console.debug("Connecting to Live API via proxy");

      // Initialize GoogleGenAI with the placeholder key and point to our server's proxy
      const ai = new (GoogleGenAI as any)({ 
          apiKey: apiKey,
          httpOptions: {
            baseUrl: window.location.origin + '/api-proxy'
          }
      });

      // Geo-grounds identification: setLocation() (called by LiveLens before
      // connect(), whenever a geolocation fix is available) is otherwise
      // just stored and never used. Appended here rather than baked into
      // setSystemInstruction so a mid-session reconnect always carries
      // whatever the latest known location is.
      const geoContext = this.latLng
          ? `\n[LOCATION CONTEXT: The explorer is near latitude ${this.latLng.latitude.toFixed(3)}, longitude ${this.latLng.longitude.toFixed(3)}. Use this to favor species plausible for this region's biome/climate — but trust clear visual evidence over geography if they conflict (e.g. an obviously captive/pet/aquarium/houseplant subject).]`
          : '';

      console.debug("[GeminiLiveService] Initiating ai.live.connect...");
      this.sessionPromise = ai.live.connect({
        model: this.model,
        config: {
          systemInstruction: { parts: [{ text: this.systemInstruction + geoContext }] },
          tools: [
              { functionDeclarations: tools }
          ],
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        } as any,
        callbacks: {
            onopen: () => {
                console.debug("[GeminiLiveService] onopen called");
                this.connected = true;
                this.reconnectAttempts = 0;
                this.delegate.onConnectionStateChange?.('CONNECTED');
                console.debug("[GeminiLiveService] Live session established.");
            },
            onmessage: async (message: LiveServerMessage) => {
                console.debug("[GeminiLiveService] onmessage received", Object.keys(message));
                if (this.sessionPromise) {
                    this.handleMessage(message, this.sessionPromise);
                }
            },
            onclose: (e) => {
                console.debug(`[GeminiLiveService] onclose called. Code: ${e.code}, Reason: ${e.reason}, Clean: ${e.wasClean}`);
                this.connected = false;
                if (!this.isManuallyClosed) {
                    this.handleReconnect();
                } else {
                    this.delegate.onConnectionStateChange?.('DISCONNECTED');
                }
            },
            onerror: (err) => {
                console.error("[GeminiLiveService] Live Error (callback):", err);
                this.delegate.onError?.(err);
                const errMsg = err?.message || String(err);
                const isFatal = isFatalLiveError(errMsg);
                if (!this.connected && !this.isManuallyClosed && !isFatal) {
                    this.handleReconnect();
                } else if (isFatal) {
                    this.delegate.onConnectionStateChange?.('DISCONNECTED');
                }
            }
        }
      });
      
      this.sessionPromise.catch(err => {
          console.error("[GeminiLiveService] ai.live.connect promise rejected:", err);
          this.delegate.onError?.(err);
          const errMsg = err?.message || String(err);
          const isFatal = isFatalLiveError(errMsg);
          if (!isFatal) {
              this.handleReconnect();
          } else {
              this.delegate.onConnectionStateChange?.('DISCONNECTED');
          }
      });

    } catch (error) {
      console.error("[GeminiLiveService] Connection failed:", error);
      this.delegate.onError?.(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const isFatal = isFatalLiveError(errMsg);
      if (!isFatal) {
          this.handleReconnect();
      } else {
          this.delegate.onConnectionStateChange?.('DISCONNECTED');
      }
    }
  }

  private handleReconnect() {
    if (this.isManuallyClosed || this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.delegate.onConnectionStateChange?.('DISCONNECTED');
        return;
    }
    if (this.reconnectTimeoutId) return;

    this.reconnectAttempts++;
    this.metrics.reconnectCount++;
    this.delegate.onConnectionStateChange?.('RECONNECTING');
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.debug(`Reconnecting in ${delay}ms (Attempt ${this.reconnectAttempts})...`);
    
    this.reconnectTimeoutId = setTimeout(() => {
        this.reconnectTimeoutId = null;
        if (!this.isManuallyClosed) this.internalConnect();
    }, delay);
  }

  public async disconnect() {
    // A genuine session end (as opposed to the internal reconnect churn
    // handled elsewhere) — the one place this session's accumulated
    // performance metrics are reported, so every call site that ends a
    // session gets this for free rather than needing its own logging call.
    const hadActivity = this.metrics.timeToFirstTokenMs !== null || Object.keys(this.metrics.toolCallCounts).length > 0;
    if (hadActivity) {
        this.delegate.onSessionMetrics?.(this.getSessionMetrics());
    }

    this.isManuallyClosed = true;
    this.connected = false;
    if (this.reconnectTimeoutId) {
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = null;
    }
    if (this.sessionPromise) {
        try {
            const session = await this.sessionPromise;
            session.close();
        } catch (e) {}
      this.sessionPromise = null;
      this.delegate.onConnectionStateChange?.('DISCONNECTED');
    }
  }

  public sendAudioChunk(pcmData: Float32Array) {
    if (!this.connected || !this.sessionPromise) {
      if (!this.connected && this.reconnectAttempts === 0) console.warn("[GeminiLiveService] sendAudioChunk: Not connected");
      return;
    }
    const buffer = floatTo16BitPCM(pcmData);
    const base64Audio = arrayBufferToBase64(buffer);
    this.sessionPromise.then(session => {
        if (!this.connected) return;
        try {
            const res = session.sendRealtimeInput({
                audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio }
            });
            if (res && res.catch) res.catch((e: any) => { 
                console.error("[GeminiLiveService] sendAudioChunk promise rejected:", e);
                this.connected = false; 
            });
        } catch (e) {
            console.error("[GeminiLiveService] Error in sendAudioChunk try-catch:", e);
            this.connected = false;
        }
    }).catch((e) => { 
        console.error("[GeminiLiveService] sendAudioChunk sessionPromise rejected:", e);
        this.connected = false; 
    });
  }

  public sendVideoFrame(base64Image: string) {
    if (!this.connected || !this.sessionPromise) {
      console.warn("[GeminiLiveService] sendVideoFrame: Not connected");
      return;
    }
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
    this.sessionPromise.then(session => {
        if (!this.connected) return;
        try {
            const res = session.sendRealtimeInput({
                video: { mimeType: "image/jpeg", data: cleanBase64 }
            });
            if (res && res.catch) res.catch((e: any) => { 
                console.error("[GeminiLiveService] sendVideoFrame promise rejected:", e);
                this.connected = false; 
            });
        } catch (e) {
            console.error("[GeminiLiveService] Error in sendVideoFrame try-catch:", e);
            this.connected = false;
        }
    }).catch((e) => { 
        console.error("[GeminiLiveService] sendVideoFrame sessionPromise rejected:", e);
        this.connected = false; 
    });
  }

  public sendText(text: string) {
    if (!this.connected || !this.sessionPromise) return;
    this.sessionPromise.then(session => {
        if (!this.connected) return;
        try {
            session.sendClientContent({
                turns: [{
                    role: 'user',
                    parts: [{ text }]
                }],
                turnComplete: true
            });
            if (this.delegate.onTranscript) {
                this.delegate.onTranscript(text, true);
            }
        } catch (e) {
            console.error("Failed to send text:", e);
        }
    });
  }

  private async handleMessage(message: LiveServerMessage, sessionPromise: Promise<any>) {
    if (message.serverContent?.interrupted) {
      this.delegate.onInterrupted?.();
    }

    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      this.markTurnResponseStart();
      try {
        const audioBytes = new Uint8Array(base64ToArrayBuffer(base64Audio));
        const audioBuffer = await decodeAudioData(audioBytes, this.outputAudioContext);
        this.delegate.onAudioData(audioBuffer);
      } catch (e) {}
    }

    let groundingLinks: GroundingLink[] = [];
    const chunks = (message.serverContent?.modelTurn as any)?.groundingMetadata?.groundingChunks;
    if (chunks && Array.isArray(chunks)) {
        chunks.forEach((chunk: any) => {
            if (chunk.web) {
                groundingLinks.push({ 
                    title: String(chunk.web.title || "Web Link"), 
                    uri: String(chunk.web.uri || "") 
                });
            }
            if (chunk.maps) {
                groundingLinks.push({ 
                    title: String(chunk.maps.title || "Maps Location"), 
                    uri: String(chunk.maps.uri || "") 
                });
            }
        });
    }

    const inputTranscript = message.serverContent?.inputTranscription?.text;
    if (inputTranscript) {
        this.currentUserTurnText += inputTranscript;
        if (this.delegate.onTranscript) this.delegate.onTranscript(this.currentUserTurnText, true);
    }

    const outputTranscript = message.serverContent?.outputTranscription?.text;
    if (outputTranscript) {
        this.markTurnResponseStart();
        this.currentModelTurnText += outputTranscript;
        if (this.delegate.onTranscript) this.delegate.onTranscript(this.currentModelTurnText, false, groundingLinks);
    }

    if (message.serverContent?.turnComplete) {
        this.currentModelTurnText = "";
        this.currentUserTurnText = "";
        this.lastTurnCompleteAt = Date.now();
        this.turnResponseStarted = false;
        this.delegate.onTurnComplete?.();
    }

    if (message.toolCall) {
      try {
          const session = await sessionPromise;
          const functionResponses = [];

          for (const fc of message.toolCall.functionCalls) {
            this.metrics.toolCallCounts[fc.name] = (this.metrics.toolCallCounts[fc.name] || 0) + 1;
            let result: any = { result: "ok" };
            if (this.delegate.onToolCall) {
                try {
                    const response = await this.delegate.onToolCall(fc.name, fc.args);
                    if (response) result = response;
                } catch (e) {
                    result = { error: "Failed to execute field tool." };
                }
            }

            functionResponses.push({
                id: fc.id,
                name: fc.name,
                response: result
            });
          }

          if (functionResponses.length > 0) {
            session.sendToolResponse({
              functionResponses: functionResponses
            });
          }
      } catch (e) {
          console.error("Tool call session failure:", e);
      }
    }
  }
}
