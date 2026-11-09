
import { GoogleGenAI, Type } from "@google/genai";
import { auth } from "../firebaseConfig";
import { EthologicalDescriptors, NaturalistPersona, CommunityPost } from "../types";

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
        CRITICAL OUTPUT DIRECTIVES:
        1. Do NOT include any introductory conversational filler, pleasantries, or preamble (e.g. DO NOT say "Based on the image...", "Here is what I found...", "I observe...").
        2. Focus strictly on the exact taxonomy (species names of plants, animals, and sources of sounds) first, followed directly by the detailed ecological insight.
        3. Do not mention that this is an "image", "audio", or "video" in your description. Speak directly about the nature subject.
        Provide the taxonomy (species names of plants, animals, and sources of sounds), an ecological insight covering all aspects, suggested hashtags, and the location.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
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
        CRITICAL OUTPUT DIRECTIVES:
        1. Do NOT include any introductory conversational filler, pleasantries, or preamble (e.g. DO NOT say "Based on the media...", "Here is the analysis...", "I see...").
        2. Focus strictly on the exact taxonomy (species names of plants, animals, and sources of sounds) first, followed directly by the detailed ecological insight.
        3. Do not mention that this is an "image", "audio", or "video" in your description. Speak directly about the nature subject.
        Provide the taxonomy (species names of plants, animals, and sources of sounds), a deep ecological insight covering all aspects, suggested hashtags, and the location.`;
        
        parts.push({ text: prompt });

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
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
            model: 'gemini-3.6-flash',
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
            model: 'gemini-3.6-flash',
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
        }
        return null;
    }
  },

  /**
   * Generates rich structured ethological and bioacoustic descriptors for a specimen.
   */
  generateEthologicalDescriptors: async (
    labels: string[],
    behavior: string,
    mediaType: 'image' | 'video' | 'audio',
    locationArea?: string
  ): Promise<EthologicalDescriptors> => {
    try {
      const apiKey = await getApiKey();
      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: { baseUrl: window.location.origin + '/api-proxy' }
      });

      const prompt = `Extract high-fidelity ethological and bioacoustic descriptors for this nature observation.
Taxonomy/Labels: ${labels.join(', ')}
Behavior & Notes: ${behavior}
Media Type: ${mediaType}
Location: ${locationArea || 'Field Observation'}

Provide a structured bioacoustic profile (frequency range, vocalization type, call rhythm if applicable), visual ethology (motion posture, diagnostic markings), and habitat niche. Speak with scientific accuracy. Do not use conversational filler or emojis.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bioacousticProfile: {
                type: Type.OBJECT,
                properties: {
                  frequencyRangeHz: { type: Type.STRING, description: "Estimated acoustic frequency range e.g. 1.5kHz - 4.2kHz or N/A" },
                  vocalizationType: { type: Type.STRING, description: "Type of sound e.g. Territorial Song, Contact Call, Alarm Chatter, Environmental Rustle" },
                  callRhythmPattern: { type: Type.STRING, description: "Rhythm description e.g. Rapid trill with descending cadence" }
                }
              },
              visualEthology: {
                type: Type.OBJECT,
                properties: {
                  motionPosture: { type: Type.STRING, description: "Observed posture or gait e.g. Perched erect, Bipedal foraging stance" },
                  diagnosticMarkings: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Key visual diagnostic field markings" }
                }
              },
              habitatNiche: {
                type: Type.OBJECT,
                properties: {
                  microHabitat: { type: Type.STRING, description: "Micro habitat location e.g. Upper canopy, Moist forest floor log" },
                  environmentalContext: { type: Type.STRING, description: "Ecological niche or ambient habitat condition" }
                }
              }
            }
          }
        }
      });

      const text = response.text || "{}";
      const parsed = JSON.parse(text);
      return {
        ...parsed,
        aiDescriptorVersion: "v1.0-gemini-3.6-flash"
      };
    } catch (e) {
      console.error("Ethological descriptors generation failed:", e);
      return {
        bioacousticProfile: {
          frequencyRangeHz: mediaType === 'audio' ? '0.5kHz - 8.0kHz' : 'N/A',
          vocalizationType: mediaType === 'audio' ? 'Acoustic Soundscape' : 'Visual Specimen',
          callRhythmPattern: 'Field Audio Record'
        },
        visualEthology: {
          motionPosture: 'Natural Field Position',
          diagnosticMarkings: labels.slice(0, 2)
        },
        habitatNiche: {
          microHabitat: locationArea || 'Field Habitat',
          environmentalContext: 'Wild Ecosystem'
        },
        aiDescriptorVersion: 'v1.0-fallback'
      };
    }
  },

  /**
   * Agentic Feed Curation Engine:
   * Uses Gemini 3.6 Flash to rank global field posts against a user's Naturalist Persona
   * and synthesize text-only Curator Field Notes.
   */
  curateAgenticFeed: async (
    persona: NaturalistPersona,
    candidatePosts: CommunityPost[]
  ): Promise<CommunityPost[]> => {
    if (!candidatePosts || candidatePosts.length === 0) return [];
    
    try {
      const apiKey = await getApiKey();
      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: { baseUrl: window.location.origin + '/api-proxy' }
      });

      const candidateSummary = candidatePosts.slice(0, 15).map(p => {
        return `[Post ID: ${p.id}]
Taxonomy: ${p.labels?.join(', ') || 'Unknown'}
Media Type: ${p.mediaType}
Behavior: ${p.behavior || p.aiInsight || 'Observation'}
Location: ${p.locationArea || 'Field'}
Bioacoustics/Descriptors: ${JSON.stringify(p.ethologicalDescriptors || {})}`;
      }).join('\n\n');

      const prompt = `You are an AI Naturalist Companion Curator.
User Naturalist Persona Profile:
Archetype: ${persona.archetype || 'Wilderness Explorer'}
Taxa Focus Areas: ${persona.taxaInterests?.join(', ') || 'All Taxa'}
Observation Styles: ${persona.observationStyles?.join(', ') || 'All Media'}
Habitat Affinities: ${persona.habitatAffinities?.join(', ') || 'All Biomes'}
Custom Naturalist Focus: ${persona.customFocus || 'None'}

Candidate Field Observations:
${candidateSummary}

CRITICAL DIRECTIVES:
1. Evaluate each observation against the user's Naturalist Persona profile.
2. Select the top relevant observations (up to 12) and rank them by relevance.
3. For EACH selected observation, write a concise, 1-2 sentence Curator Field Note explaining specifically why this observation matches their specific naturalist profile or research interest.
4. DO NOT use any emojis in the Curator Field Notes. Keep tone objective, scientific, and field-guide concise.
5. Return JSON with the list of curated items containing postId, curatorNote, and relevanceScore (1-100).`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              curatedItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    postId: { type: Type.STRING },
                    curatorNote: { type: Type.STRING, description: "Text-only concise field note explaining why this fits user's persona. No emojis." },
                    relevanceScore: { type: Type.NUMBER }
                  },
                  required: ["postId", "curatorNote", "relevanceScore"]
                }
              }
            },
            required: ["curatedItems"]
          }
        }
      });

      const text = response.text || "{}";
      const result = JSON.parse(text);
      const curatedMap = new Map<string, { curatorNote: string; relevanceScore: number }>();
      
      if (Array.isArray(result.curatedItems)) {
        result.curatedItems.forEach((item: any) => {
          if (item.postId && item.curatorNote) {
            curatedMap.set(item.postId, {
              curatorNote: item.curatorNote.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim(),
              relevanceScore: item.relevanceScore || 50
            });
          }
        });
      }

      // Map back to candidate posts, attach curatorNote, and sort by relevanceScore
      const curatedPosts: CommunityPost[] = [];
      const remainingPosts: CommunityPost[] = [];

      candidatePosts.forEach(post => {
        const curatedInfo = curatedMap.get(post.id);
        if (curatedInfo) {
          curatedPosts.push({
            ...post,
            curatorNote: curatedInfo.curatorNote
          });
        } else {
          const primaryTag = post.labels?.[0] || 'nature observation';
          remainingPosts.push({
            ...post,
            curatorNote: `Curator Note: Suggested field observation featuring ${primaryTag} in ${post.locationArea || 'wild habitat'}.`
          });
        }
      });

      curatedPosts.sort((a, b) => {
        const scoreA = curatedMap.get(a.id)?.relevanceScore || 0;
        const scoreB = curatedMap.get(b.id)?.relevanceScore || 0;
        return scoreB - scoreA;
      });

      return [...curatedPosts, ...remainingPosts];
    } catch (e) {
      console.error("Agentic feed curation failed, falling back to local heuristic curation:", e);
      return candidatePosts.map(post => {
        const primaryTaxa = post.labels?.[0] || 'specimen';
        return {
          ...post,
          curatorNote: `Curator Note: Field sighting of ${primaryTaxa} matched for your natural history journal.`
        };
      });
    }
  }
};
