
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { tools } from "../constants";
import { floatTo16BitPCM, arrayBufferToBase64, decodeAudioData, base64ToArrayBuffer } from "./audioUtils";
import { GroundingLink } from "../types";
import { auth } from "../firebaseConfig";

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

      console.debug("[GeminiLiveService] Initiating ai.live.connect...");
      this.sessionPromise = ai.live.connect({
        model: this.model,
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
