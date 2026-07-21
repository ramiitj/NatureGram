
import { GoogleGenAI, Type } from "@google/genai";
import { auth } from "../firebaseConfig";

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

export const GenAiService = {
  /**
   * Analyzes an audio or image blob to extract ecological insights.
   */
  analyzeMedia: async (blob: Blob, type: 'audio' | 'image' | 'video', location?: string): Promise<{ taxonomy: string[], ecologic: string, hashtags: string[], location: string }> => {
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
        Provide the taxonomy (species names of plants, animals, and sources of sounds), an ecological insight covering all aspects, suggested hashtags, and the location.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
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
                        taxonomy: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of identified species or sounds." },
                        ecologic: { type: Type.STRING, description: "Detailed ecological insight, behavior, or habitat description." },
                        hashtags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of relevant hashtags without the # symbol." },
                        location: { type: Type.STRING, description: "The location of the observation, inferred or provided." }
                    },
                    required: ["taxonomy", "ecologic", "hashtags", "location"]
                }
            }
        });

        const text = response.text || "{}";
        const result = JSON.parse(text);
        return {
            taxonomy: result.taxonomy || ["Unknown"],
            ecologic: result.ecologic || "Analysis pending.",
            hashtags: result.hashtags || ["Nature"],
            location: result.location || location || "Unknown Location"
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
  analyzeMultimodal: async (mediaBlob: Blob | null, imageBlobs: Blob[], location?: string): Promise<{ taxonomy: string[], ecologic: string, hashtags: string[], location: string }> => {
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
        Provide the taxonomy (species names of plants, animals, and sources of sounds), a deep ecological insight covering all aspects, suggested hashtags, and the location.`;
        
        parts.push({ text: prompt });

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: { parts },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        taxonomy: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Identified species or sounds." },
                        ecologic: { type: Type.STRING, description: "Deep ecological insight." },
                        hashtags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Relevant hashtags." },
                        location: { type: Type.STRING, description: "Inferred or provided location." }
                    },
                    required: ["taxonomy", "ecologic", "hashtags", "location"]
                }
            }
        });

        const text = response.text || "{}";
        const result = JSON.parse(text);
        return {
            taxonomy: result.taxonomy || ["Unknown"],
            ecologic: result.ecologic || "Analysis pending.",
            hashtags: result.hashtags || ["Nature"],
            location: result.location || location || "Unknown Location"
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
        
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "A unifying title for the collection." },
                        description: { type: Type.STRING, description: "A cohesive summary description." }
                    },
                    required: ["title", "description"]
                }
            }
        });

        const text = response.text || "{}";
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
