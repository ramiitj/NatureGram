
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { apiUrl } from './apiOrigin';
import { tools } from "../constants";
import { floatTo16BitPCM, arrayBufferToBase64, decodeAudioData, base64ToArrayBuffer } from "./audioUtils";
import { GroundingLink } from "../types";
import { auth } from "../firebaseConfig";
import { appCheckHeaders, appCheckToken } from "./appCheck";

interface GeminiLiveDelegate {
  onAudioData: (audioBuffer: AudioBuffer) => void;
  onInterrupted?: () => void;
  onTranscript?: (text: string, isUser: boolean, groundingLinks?: GroundingLink[]) => void;
  onToolCall?: (name: string, args: any) => Promise<any>;
  onConnectionStateChange?: (state: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING') => void;
  onError?: (error: any) => void;
  onTurnComplete?: () => void;
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
  private model: string = 'models/gemini-3.5-flash';
  private latLng: { latitude: number, longitude: number } | null = null;

  private currentModelTurnText: string = "";
  private currentUserTurnText: string = "";

  constructor(audioContext: AudioContext, delegate: GeminiLiveDelegate) {
    this.delegate = delegate;
    this.outputAudioContext = audioContext;
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
    await this.internalConnect();
  }

  // ------------------------------------------------------------------ direct sessions (ephemeral tokens)
  // When the server allows it (LIVE_DIRECT_TOKENS), the app asks for a one-use token locked to the
  // governed model, prompt, policy and tools, and talks to Gemini directly. Any failure falls back to
  // the server proxy for the rest of this guide's life. Live minutes are still counted: the lease is
  // heartbeated and the session length is reported when it ends.
  private directDisabled = false;
  private direct: { leaseId: string; openedAt: number; beat: any; onHide: () => void } | null = null;
  private static liveConfig: Promise<{ direct: boolean; heartbeatMs: number }> | null = null;

  private static getLiveConfig() {
    if (!GeminiLiveService.liveConfig) {
      GeminiLiveService.liveConfig = fetch(apiUrl('/api/live/config'))
        .then(r => (r.ok ? r.json() : { direct: false, heartbeatMs: 30000 }))
        .catch(() => ({ direct: false, heartbeatMs: 30000 }));
    }
    return GeminiLiveService.liveConfig;
  }

  private sessionConfig() {
    return {
      systemInstruction: { parts: [{ text: this.systemInstruction }] },
      tools: [{ functionDeclarations: tools }],
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    };
  }

  /** Ask for an ephemeral token; null means "use the proxy". */
  private async mintDirect(idToken: string): Promise<{ token: string; model: string; leaseId: string; heartbeatMs: number } | null> {
    if (this.directDisabled || !auth.currentUser) return null;
    const cfg = await GeminiLiveService.getLiveConfig();
    if (!cfg.direct) return null;
    try {
      const c = this.sessionConfig();
      const res = await fetch(apiUrl('/api/live/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...(await appCheckHeaders()) },
        body: JSON.stringify({ setup: { systemInstruction: c.systemInstruction, tools: c.tools, generationConfig: { responseModalities: c.responseModalities, speechConfig: c.speechConfig } } }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok && out.token) return out;
      // Allowance, rate and concurrency refusals are real answers: the proxy would refuse too, so say so
      if (res.status === 429 || res.status === 403) {
        throw Object.assign(new Error(out.message || 'The live guide is unavailable right now.'), { code: res.status === 429 ? 4429 : 4403, governed: true });
      }
      return null;
    } catch (e: any) {
      if (e?.governed) throw e;
      return null;
    }
  }

  private startDirect(leaseId: string, heartbeatMs: number) {
    const send = (path: string, body: any, keepalive = false) => auth.currentUser?.getIdToken().then(t => fetch(apiUrl(path), {
      method: 'POST', keepalive, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
    })).catch(() => {});
    const beat = setInterval(() => { send('/api/live/heartbeat', { leaseId }); }, Math.max(10_000, heartbeatMs || 30_000));
    const onHide = () => { this.endDirect(true); };
    window.addEventListener('pagehide', onHide);
    this.direct = { leaseId, openedAt: 0, beat, onHide };
  }

  /** Report the end of a direct session once (opened = 0 means it never started: nothing is charged). */
  private endDirect(keepalive = false) {
    const d = this.direct;
    if (!d) return;
    this.direct = null;
    clearInterval(d.beat);
    window.removeEventListener('pagehide', d.onHide);
    const ms = d.openedAt ? Date.now() - d.openedAt : 0;
    auth.currentUser?.getIdToken().then(t => fetch(apiUrl('/api/live/end'), {
      method: 'POST', keepalive, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ leaseId: d.leaseId, ms }),
    })).catch(() => {});
  }

  /** A direct session failed before it opened: stop trying direct and reconnect through the proxy. */
  private fallBackToProxy(reason: unknown) {
    console.warn('[GeminiLiveService] Direct live session failed; using the server connection.', reason);
    this.endDirect();
    this.directDisabled = true;
    if (!this.isManuallyClosed) this.internalConnect();
  }

  private async internalConnect() {
    try {
      // Use Firebase Auth token as the key for the proxy to verify
      let apiKey = "PROXY";
      if (auth.currentUser) {
          apiKey = await auth.currentUser.getIdToken();
      }

      let ai: any;
      let model = this.model;
      let minted: Awaited<ReturnType<GeminiLiveService['mintDirect']>> = null;
      try {
        minted = await this.mintDirect(apiKey);
      } catch (e: any) {
        // Governed refusal (allowance, concurrency): surface it, don't retry
        this.isManuallyClosed = true;
        this.delegate.onError?.(e);
        this.delegate.onConnectionStateChange?.('DISCONNECTED');
        return;
      }
      const isDirect = !!minted;
      if (minted) {
        console.debug("Connecting to Live API directly with a one-use token");
        this.startDirect(minted.leaseId, minted.heartbeatMs);
        ai = new (GoogleGenAI as any)({ apiKey: minted.token, httpOptions: { apiVersion: 'v1alpha' } });
        model = minted.model || this.model;
      } else {
        console.debug("Connecting to Live API via proxy");
        // App Check token rides in the path (browsers can't set headers on a websocket); the server strips it
        const ac = await appCheckToken();
        ai = new (GoogleGenAI as any)({
            apiKey: apiKey,
            httpOptions: {
              baseUrl: apiUrl(ac ? `/api-proxy/ac/${ac}` : '/api-proxy')
            }
        });
      }
      let opened = false;
      let fellBack = false;
      // A direct session that never opened goes back to the proxy, once
      const tryFallback = (reason: unknown) => {
        if (!isDirect || opened || fellBack || this.isManuallyClosed) return false;
        fellBack = true;
        this.connected = false;
        this.fallBackToProxy(reason);
        return true;
      };

      console.debug("[GeminiLiveService] Initiating ai.live.connect...");
      this.sessionPromise = ai.live.connect({
        model,
        config: {
          systemInstruction: { parts: [{ text: this.systemInstruction }] },
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
                opened = true;
                if (isDirect && this.direct) this.direct.openedAt = Date.now();
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
                if (tryFallback(e.reason) || fellBack) return;
                if (isDirect) this.endDirect();
                this.connected = false;
                // 4xxx = governed by the server (quota, time limit, policy) and 1008 = policy violation:
                // these must not auto-reconnect; surface the reason to the explorer instead.
                const governed = e.code === 1008 || (e.code >= 4000 && e.code <= 4999)
                    || /timeout|session/i.test(e.reason || '')
                    || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
                if (governed && !this.isManuallyClosed) {
                    this.isManuallyClosed = true;
                    this.delegate.onError?.(Object.assign(new Error(e.reason || 'The live guide session ended.'), { code: e.code, governed: true }));
                    this.delegate.onConnectionStateChange?.('DISCONNECTED');
                } else if (!this.isManuallyClosed) {
                    this.handleReconnect();
                } else {
                    this.delegate.onConnectionStateChange?.('DISCONNECTED');
                }
            },
            onerror: (err) => {
                console.error("[GeminiLiveService] Live Error (callback):", err);
                if (tryFallback(err) || fellBack) return;
                this.delegate.onError?.(err);
                const errMsg = err?.message || String(err);
                const isFatal = errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") || errMsg.includes("403");
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
          if (tryFallback(err) || fellBack) return;
          this.delegate.onError?.(err);
          const errMsg = err?.message || String(err);
          const isFatal = errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") || errMsg.includes("403");
          if (!isFatal) {
              this.handleReconnect();
          } else {
              this.delegate.onConnectionStateChange?.('DISCONNECTED');
          }
      });

    } catch (error) {
      console.error("[GeminiLiveService] Connection failed:", error);
      if (this.direct && !this.direct.openedAt && !this.directDisabled) { this.fallBackToProxy(error); return; }
      this.delegate.onError?.(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const isFatal = errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") || errMsg.includes("403");
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
    this.delegate.onConnectionStateChange?.('RECONNECTING');
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.debug(`Reconnecting in ${delay}ms (Attempt ${this.reconnectAttempts})...`);
    
    this.reconnectTimeoutId = setTimeout(() => {
        this.reconnectTimeoutId = null;
        if (!this.isManuallyClosed) this.internalConnect();
    }, delay);
  }

  public async disconnect() {
    this.isManuallyClosed = true;
    this.endDirect();
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
        this.currentModelTurnText += outputTranscript;
        if (this.delegate.onTranscript) this.delegate.onTranscript(this.currentModelTurnText, false, groundingLinks);
    }
    
    if (message.serverContent?.turnComplete) {
        this.currentModelTurnText = "";
        this.currentUserTurnText = "";
        this.delegate.onTurnComplete?.();
    }

    if (message.toolCall) {
      try {
          const session = await sessionPromise;
          const functionResponses = [];

          for (const fc of message.toolCall.functionCalls) {
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
