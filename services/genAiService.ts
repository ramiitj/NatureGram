
import { GoogleGenAI, Type } from "@google/genai";
import { auth } from "../firebaseConfig";
import { FirebaseService } from "./firebaseService";

// The server's /api-proxy route now requires a verified Firebase ID token
// (the same scheme used by the Live WebSocket proxy) before it will relay
// requests to Gemini. The GoogleGenAI SDK sends this value as the "key"
// query param on every request, which the server verifies before swapping
// in the real Gemini API key.
export const getApiKey = async (): Promise<string> => {
    const currentUser = auth.currentUser;
    if (currentUser) {
        try {
            return await currentUser.getIdToken();
        } catch (e) {
            console.warn("Failed to get ID token, falling back to PROXY token");
        }
    }
    return "PROXY";
};

// Flash-first model routing: try the cheaper Flash model first and only
// escalate to Pro when Flash fails outright or comes back with a
// low-confidence/empty identification. This also acts as a safety net if
// FLASH_MODEL ever turns out to be invalid/unavailable for the project —
// analysis still completes via Pro instead of erroring out for users.
const FLASH_MODEL = 'gemini-2.5-flash';
const PRO_MODEL = 'gemini-3.1-pro-preview';

// Shared safety governance for both single- and multi-modal analysis below.
// Mirrors the equivalent rules in constants.ts's SYSTEM_INSTRUCTION for the
// live agent, so a post-capture analysis and a live-session identification
// of the same subject are governed by the same policy.
const SAFETY_INSTRUCTIONS = `
SAFETY (non-negotiable): Never include edibility, toxicity, medicinal, or "is it safe to touch/eat" guidance for any fungus, plant, berry, or organism, even with disclaimers — misidentified "edible" species is a documented cause of serious injury and death. If the subject invites that question, the ecological insight should stick to identification and biology only. If a person is a prominent subject in the media, do not describe, identify, or make demographic claims about them — acknowledge their presence neutrally at most.`;

interface TaxonomyResult {
    taxonomy: string[];
    ecologic: string;
    hashtags: string[];
    location: string;
    confidence?: string;
    isNatureSubject?: boolean;
    isHybrid?: boolean;
}

const TAXONOMY_SCHEMA_PROPERTIES = {
    isNatureSubject: { type: Type.BOOLEAN, description: "False if the media contains no plant, animal, fungus, or other natural subject (e.g. it's a room, a vehicle, a screen, a document). True otherwise." },
    taxonomy: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of identified species or sounds. If isNatureSubject is false, an empty array." },
    ecologic: { type: Type.STRING, description: "Detailed ecological insight, behavior, or habitat description. If isNatureSubject is false, a brief plain statement that no natural subject was found — never an invented reading of the scene." },
    hashtags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of relevant hashtags without the # symbol." },
    location: { type: Type.STRING, description: "The location of the observation, inferred or provided." },
    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'], description: "Your confidence in this identification." },
    isHybrid: { type: Type.BOOLEAN, description: "True if man-made structures (buildings, roads, vehicles, fences) are also visible in frame alongside the natural subject." }
};

// Only meaningful when isNatureSubject is true — a confident "no nature
// subject here" is a valid, useful result, not a low-confidence one.
const isLowConfidenceOrEmpty = (result: TaxonomyResult): boolean => {
    if (result.isNatureSubject === false) return false;
    const hasTaxonomy = Array.isArray(result.taxonomy) && result.taxonomy.length > 0 && result.taxonomy[0] !== "Unknown";
    return !hasTaxonomy || result.confidence === 'low';
};

const logUsage = (feature: string, model: string, usage?: { promptTokenCount?: number, candidatesTokenCount?: number, totalTokenCount?: number }) => {
    console.debug(`[GenAiService] ${feature} via ${model} — tokens (prompt/output/total):`, usage?.promptTokenCount, usage?.candidatesTokenCount, usage?.totalTokenCount);

    // Persist for the AdminConsole cost panel. Best-effort and non-blocking:
    // a telemetry write failure should never surface to the caller or delay
    // the (already-completed) AI call it's describing.
    const uid = auth.currentUser?.uid;
    if (uid) {
        FirebaseService.logAiUsage({
            uid,
            feature,
            model,
            promptTokenCount: usage?.promptTokenCount,
            candidatesTokenCount: usage?.candidatesTokenCount,
            totalTokenCount: usage?.totalTokenCount,
        }).catch(() => {});
    }
};

// Runs a taxonomy-identification prompt against Flash first; escalates to
// Pro if Flash throws or returns a low-confidence/empty result.
const generateTaxonomyWithFallback = async (ai: GoogleGenAI, contents: any): Promise<{ result: TaxonomyResult, modelUsed: string }> => {
    const config = {
        responseMimeType: "application/json" as const,
        responseSchema: {
            type: Type.OBJECT,
            properties: TAXONOMY_SCHEMA_PROPERTIES,
            required: ["isNatureSubject", "taxonomy", "ecologic", "hashtags", "location"]
        }
    };

    try {
        const flashResponse = await ai.models.generateContent({ model: FLASH_MODEL, contents, config });
        const result = JSON.parse(flashResponse.text || "{}") as TaxonomyResult;
        if (!isLowConfidenceOrEmpty(result)) {
            logUsage('taxonomy', FLASH_MODEL, flashResponse.usageMetadata);
            return { result, modelUsed: FLASH_MODEL };
        }
        console.debug("[GenAiService] Flash result low-confidence/empty, escalating to Pro");
    } catch (flashErr) {
        console.warn("[GenAiService] Flash analysis call failed, escalating to Pro:", flashErr);
    }

    const proResponse = await ai.models.generateContent({ model: PRO_MODEL, contents, config });
    const result = JSON.parse(proResponse.text || "{}") as TaxonomyResult;
    logUsage('taxonomy', PRO_MODEL, proResponse.usageMetadata);
    return { result, modelUsed: PRO_MODEL };
};

// Defense in depth for every analyzeMedia/analyzeMultimodal caller: even
// though the prompt/schema already instruct the model not to invent a
// natural reading of a non-nature scene, don't trust its free-text
// taxonomy/insight in that case — override with a fixed, honest message.
// Centralized here so every capture path (live tool call, upload, session
// finalize) applies the same scope-gate handling instead of four separate
// copies drifting apart.
export const resolveNatureSubjectFields = (result: { taxonomy: string[], ecologic: string, isNatureSubject?: boolean }): { labels: string[], aiInsight: string, isNatureSubject: boolean } => {
    const isNatureSubject = result.isNatureSubject !== false;
    return {
        isNatureSubject,
        labels: isNatureSubject ? result.taxonomy : ['No Nature Subject Detected'],
        aiInsight: isNatureSubject ? result.ecologic : "This capture doesn't appear to contain a natural subject.",
    };
};

export const GenAiService = {
  /**
   * Analyzes an audio or image blob to extract ecological insights.
   */
  analyzeMedia: async (blob: Blob, type: 'audio' | 'image' | 'video', location?: string): Promise<{ taxonomy: string[], ecologic: string, hashtags: string[], location: string, confidence?: 'high' | 'medium' | 'low', isNatureSubject?: boolean, isHybrid?: boolean }> => {
    try {
        const apiKey = await getApiKey();
        const ai = new GoogleGenAI({ 
            apiKey,
            httpOptions: { baseUrl: window.location.origin + '/api-proxy' }
        });
        
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        await new Promise(resolve => reader.onload = resolve);
        const base64 = (reader.result as string).split(',')[1];
        
        const prompt = `Analyze this field observation${location ? ` from location: ${location}` : ''}.
        Identify all species or natural phenomena present. If this is a video, you MUST analyze all aspects: visible plants, visible animals, and any audible sounds or calls. Provide a deep ecological analysis of the subjects' behavior, habitat, interactions, or significance.
        CRITICAL: Do not mention that this is an "image", "audio", or "video" in your description. Speak directly about the nature subject.
        Provide the taxonomy (species names of plants, animals, and sources of sounds), an ecological insight covering all aspects, suggested hashtags, and the location.
        Also include your confidence ('high', 'medium', or 'low') in this identification, and whether man-made structures are also visible alongside the natural subject.
        ${SAFETY_INSTRUCTIONS}`;

        const { result } = await generateTaxonomyWithFallback(ai, {
            parts: [
                { inlineData: { data: base64, mimeType: blob.type } },
                { text: prompt }
            ]
        });

        return {
            taxonomy: result.taxonomy || ["Unknown"],
            ecologic: result.ecologic || "Analysis pending.",
            hashtags: result.hashtags || ["Nature"],
            location: result.location || location || "Unknown Location",
            confidence: result.confidence as 'high' | 'medium' | 'low' | undefined,
            isNatureSubject: result.isNatureSubject,
            isHybrid: result.isHybrid
        };
    } catch (e) {
        console.error("Media analysis failed", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") || JSON.stringify(e).includes("API_KEY_HTTP_REFERRER_BLOCKED")) {
            return { taxonomy: ["Error"], ecologic: "API Key Referrer Blocked: Please update your Google Cloud Console API key restrictions to allow 'https://aistudio.google.com/*' and 'https://*.run.app/*'.", hashtags: ["Error"], location: location || "Unknown Location" };
        }
        return { taxonomy: ["Unknown"], ecologic: "Analysis failed.", hashtags: ["Nature"], location: location || "Unknown Location" };
    }
  },

  /**
   * Analyzes multiple modalities (audio + images) to extract deep ecological insights.
   * This prioritizes audio fidelity while using images for grounding.
   */
  analyzeMultimodal: async (mediaBlob: Blob | null, imageBlobs: Blob[], location?: string): Promise<{ taxonomy: string[], ecologic: string, hashtags: string[], location: string, confidence?: 'high' | 'medium' | 'low', isNatureSubject?: boolean, isHybrid?: boolean }> => {
    try {
        const apiKey = await getApiKey();
        const ai = new GoogleGenAI({ 
            apiKey,
            httpOptions: { baseUrl: window.location.origin + '/api-proxy' }
        });
        const parts: any[] = [];

        if (mediaBlob) {
            const reader = new FileReader();
            reader.readAsDataURL(mediaBlob);
            await new Promise(resolve => reader.onload = resolve);
            const mediaBase64 = (reader.result as string).split(',')[1];
            parts.push({ inlineData: { data: mediaBase64, mimeType: mediaBlob.type } });
        }

        for (const imgBlob of imageBlobs) {
            const reader = new FileReader();
            reader.readAsDataURL(imgBlob);
            await new Promise(resolve => reader.onload = resolve);
            const imgBase64 = (reader.result as string).split(',')[1];
            parts.push({ inlineData: { data: imgBase64, mimeType: imgBlob.type } });
        }

        const prompt = `Analyze this field observation${location ? ` from ${location}` : ''}.
        Focus on the high-fidelity media recording (audio or video) to identify species by sound and movement, and use the provided images to ground the visual context.
        Identify all species or natural phenomena present. You MUST analyze all aspects: visible plants, visible animals, and any audible sounds or calls. Provide a deep ecological analysis of the subjects' behavior, habitat, interactions, or evolutionary significance.
        CRITICAL: Do not mention that this is an "image", "audio", or "video" in your description. Speak directly about the nature subject.
        Provide the taxonomy (species names of plants, animals, and sources of sounds), a deep ecological insight covering all aspects, suggested hashtags, and the location.
        Also include your confidence ('high', 'medium', or 'low') in this identification, and whether man-made structures are also visible/audible alongside the natural subject.
        ${SAFETY_INSTRUCTIONS}`;

        parts.push({ text: prompt });

        const { result } = await generateTaxonomyWithFallback(ai, { parts });

        return {
            taxonomy: result.taxonomy || ["Unknown"],
            ecologic: result.ecologic || "Analysis pending.",
            hashtags: result.hashtags || ["Nature"],
            location: result.location || location || "Unknown Location",
            confidence: result.confidence as 'high' | 'medium' | 'low' | undefined,
            isNatureSubject: result.isNatureSubject,
            isHybrid: result.isHybrid
        };
    } catch (e) {
        console.error("Multimodal analysis failed", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") || JSON.stringify(e).includes("API_KEY_HTTP_REFERRER_BLOCKED")) {
            return { taxonomy: ["Error"], ecologic: "API Key Referrer Blocked: Please update your Google Cloud Console API key restrictions to allow 'https://aistudio.google.com/*' and 'https://*.run.app/*'.", hashtags: ["Error"], location: location || "Unknown Location" };
        }
        return { taxonomy: ["Unknown"], ecologic: "Analysis failed.", hashtags: ["Nature"], location: location || "Unknown Location" };
    }
  },

  /**
   * Synthesizes a unified title and description for a collection of observations.
   */
  synthesizeCollection: async (items: { taxonomy: string[], ecologic: string }[]): Promise<{ title: string, description: string }> => {
    try {
        const apiKey = await getApiKey();
        const ai = new GoogleGenAI({ 
            apiKey,
            httpOptions: { baseUrl: window.location.origin + '/api-proxy' }
        });
        
        const summaryText = items.map((i, idx) => `Item ${idx + 1}: Species: ${i.taxonomy.join(', ')}. Insight: ${i.ecologic}`).join('\n');
        
        const prompt = `The user is posting a collection of nature observations. Here are the details of the items in the collection:
        ${summaryText}

        Generate a unifying title (e.g., 'Morning Avian and Flora Observations') and a cohesive summary description for this entire collection.
        Do not mention "Item 1" or "Item 2". Speak generally about the collection of observations.`;

        const config = {
            responseMimeType: "application/json" as const,
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING, description: "A unifying title for the collection." },
                    description: { type: Type.STRING, description: "A cohesive summary description." }
                },
                required: ["title", "description"]
            }
        };

        // Pure text summarization of already-extracted taxonomy/insight
        // strings — no vision/audio involved, so Flash is a safe direct
        // swap here rather than needing a confidence-based escalation.
        let text: string;
        try {
            const response = await ai.models.generateContent({ model: FLASH_MODEL, contents: prompt, config });
            text = response.text || "{}";
            logUsage('synthesizeCollection', FLASH_MODEL, response.usageMetadata);
        } catch (flashErr) {
            console.warn("[GenAiService] Flash synthesis call failed, falling back to Pro:", flashErr);
            const response = await ai.models.generateContent({ model: PRO_MODEL, contents: prompt, config });
            text = response.text || "{}";
            logUsage('synthesizeCollection', PRO_MODEL, response.usageMetadata);
        }

        const result = JSON.parse(text);
        return {
            title: result.title || "Field Collection",
            description: result.description || "A collection of field observations."
        };
    } catch (e) {
        console.error("Collection synthesis failed", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") || JSON.stringify(e).includes("API_KEY_HTTP_REFERRER_BLOCKED")) {
            return { title: "API Key Blocked", description: "API Key Referrer Blocked: Please update your Google Cloud Console API key restrictions to allow 'https://aistudio.google.com/*' and 'https://*.run.app/*'." };
        }
        return { title: "Field Collection", description: "A collection of field observations." };
    }
  },

  /**
   * Automated content-safety pre-screen for a post's primary media, run at
   * post-creation time. This is a triage filter, not a final moderation
   * decision: flagged content is routed to reportStatus: 'pending' (the
   * existing AdminConsole moderation queue) for human review rather than
   * being blocked outright, and any error here fails OPEN (defaults to
   * "safe") so a moderation-check outage can never block posting entirely
   * — the tradeoff is that a transient failure means that one post skips
   * screening, same as before this feature existed.
   */
  checkContentSafety: async (blob: Blob | undefined | null): Promise<{ isSafe: boolean, reason: string }> => {
    if (!blob) return { isSafe: true, reason: 'No media to screen.' };
    try {
        const apiKey = await getApiKey();
        const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { baseUrl: window.location.origin + '/api-proxy' }
        });

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        await new Promise(resolve => reader.onload = resolve);
        const base64 = (reader.result as string).split(',')[1];

        const prompt = `You are a content moderator for NatureGram, a nature/wildlife photography and field-journal community app.
        Review this media and determine if it violates community guidelines: sexually explicit content, graphic violence or gore, hate symbols or harassment, or content that is clearly unrelated spam/abuse rather than a genuine nature/field observation.
        Ordinary nature photography (including injured/dead wildlife documented for scientific or educational purposes, e.g. predation) is allowed and should be marked safe.
        Respond with whether this is safe to publish and a brief reason.`;

        const response = await ai.models.generateContent({
            model: FLASH_MODEL,
            contents: {
                parts: [
                    { inlineData: { data: base64, mimeType: blob.type } },
                    { text: prompt }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        isSafe: { type: Type.BOOLEAN, description: "False if this media violates community guidelines and needs human review." },
                        reason: { type: Type.STRING, description: "Brief reason for the classification." }
                    },
                    required: ["isSafe", "reason"]
                }
            }
        });

        logUsage('contentSafety', FLASH_MODEL, response.usageMetadata);
        const result = JSON.parse(response.text || "{}");
        return {
            isSafe: result.isSafe !== false,
            reason: result.reason || (result.isSafe === false ? 'Flagged by automated screening.' : 'Passed automated screening.')
        };
    } catch (e) {
        console.warn("[GenAiService] Content safety check failed, defaulting to safe (fail-open):", e);
        return { isSafe: true, reason: 'Automated screening unavailable; not reviewed.' };
    }
  },

  /**
   * Generates a visual representation of an audio summary using Gemini 2.5 Flash Image ("Nano Banana").
   */
  generateImageFromSummary: async (summary: string): Promise<string | null> => {
    try {
        const apiKey = await getApiKey();
        const ai = new GoogleGenAI({ 
            apiKey,
            httpOptions: { baseUrl: window.location.origin + '/api-proxy' }
        });
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [{ text: `Create a cinematic, photorealistic nature photograph that captures the essence of this soundscape description: "${summary}". The image should look like high-end nature photography, highly detailed, atmospheric lighting.` }]
            }
        });

        const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        
        if (part && part.inlineData && part.inlineData.data) {
            const mime = part.inlineData.mimeType || 'image/png';
            return `data:${mime};base64,${part.inlineData.data}`;
        }
        return null;
    } catch (e) {
        console.error("Generative visual failed", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes("referer") || errMsg.includes("API_KEY_HTTP_REFERRER_BLOCKED") || JSON.stringify(e).includes("API_KEY_HTTP_REFERRER_BLOCKED")) {
            console.error("API Key Referrer Blocked: Please update your Google Cloud Console API key restrictions to allow 'https://aistudio.google.com/*' and 'https://*.run.app/*'.");
            // We could return a specific error image or just null
        }
        return null;
    }
  }
};
