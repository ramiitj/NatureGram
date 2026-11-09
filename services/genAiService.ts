import { GoogleGenAI, Type } from "@google/genai";
import { apiUrl } from './apiOrigin';
import { auth } from "../firebaseConfig";
import type { EthologicalDescriptors, NaturalistPersona, CommunityPost } from "../types";

/**
 * Governed AI analysis for NatureGram.
 *
 * Contract (see docs/AI_GOVERNANCE.md):
 *  - Every result carries a calibrated confidence, the evidence used, and safety flags.
 *  - The model abstains to a broader rank instead of guessing a species.
 *  - The model never invents a location; location comes only from the device.
 *  - Failures throw. Nothing fabricated is ever returned as an analysis.
 *  - Model choice is resolved server-side from aliases (ng-identify, ng-synthesize),
 *    so models can be changed or rolled back without shipping a new client.
 */

export const AI_PROMPT_VERSION = 'identify-2026.11-1';
const MODEL_IDENTIFY = 'ng-identify';
const MODEL_SYNTHESIZE = 'ng-synthesize';
const MAX_INLINE_BYTES = 18 * 1024 * 1024;
const TIMEOUT_MS = 90_000;

export type Confidence = 'high' | 'medium' | 'low';

export interface Identification {
  commonName: string;
  scientificName: string;
  rank: 'species' | 'genus' | 'family' | 'order' | 'class' | 'kingdom' | 'other';
  confidence: Confidence;
  evidence: string;
}

export interface AnalysisFlags {
  isNatureSubject: boolean;
  fungi: boolean;
  dangerous: boolean;
  sensitiveSpecies: boolean;
  peopleVisible: boolean;
}

export interface AnalysisResult {
  /** Display labels for the organisms present (common names first). Back-compatible with `labels`. */
  taxonomy: string[];
  /** Behaviour + ecology narrative. */
  ecologic: string;
  hashtags: string[];
  /** Location is never inferred by the model: this is the device-provided area (or ""). */
  location: string;
  confidence: Confidence;
  identifications: Identification[];
  flags: AnalysisFlags;
  needsExpertReview: boolean;
  safetyNote: string;
  model: string;
  promptVersion: string;
}

export class AiError extends Error {
  constructor(message: string, public readonly kind: 'quota' | 'too_large' | 'auth' | 'unavailable' | 'invalid' | 'timeout') {
    super(message);
  }
}

export const getApiKey = async (): Promise<string> => {
  const currentUser = auth.currentUser;
  if (currentUser) {
    try { return await currentUser.getIdToken(); } catch { /* fall through */ }
  }
  return "PROXY";
};

const client = async () => new GoogleGenAI({ apiKey: await getApiKey(), httpOptions: { baseUrl: apiUrl('/api-proxy') } });

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const classify = (e: any): AiError => {
  const msg = String(e?.message || e || '');
  const status = e?.status || e?.code || (msg.match(/"code":\s*(\d{3})/)?.[1] ? Number(msg.match(/"code":\s*(\d{3})/)![1]) : 0);
  if (e instanceof AiError) return e;
  if (status === 429 || /quota|limit reached|too many/i.test(msg)) return new AiError(/Daily AI limit[^"]*/.exec(msg)?.[0] || "You've reached today's AI limit. You can still label sightings yourself.", 'quota');
  if (status === 413 || /too large/i.test(msg)) return new AiError('This file is too large to analyse. Try a shorter clip.', 'too_large');
  if (status === 401 || status === 403) return new AiError('Please sign in again to use AI identification.', 'auth');
  if (/timeout|aborted/i.test(msg)) return new AiError('The analysis took too long. Please try again.', 'timeout');
  return new AiError('AI identification is temporarily unavailable.', 'unavailable');
};

/** Retries transient failures (429 per-minute, 5xx, network) with backoff; never retries quota/auth/size. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: AiError | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
      ]);
    } catch (e) {
      last = classify(e);
      const daily = last.kind === 'quota' && /daily/i.test(last.message);
      if (last.kind === 'auth' || last.kind === 'too_large' || daily) break;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 800 * Math.pow(2, i) + Math.random() * 300));
    }
  }
  throw last || new AiError('AI identification is temporarily unavailable.', 'unavailable');
}

const IDENTIFY_INSTRUCTIONS = `You are NatureGram's field identification system. Your output is shown to explorers as an AI suggestion that they review before publishing.

Rules:
1. Identify every prominent organism (or natural sound source). Use the most specific taxonomic rank the evidence supports. If uncertain at species level, give the genus or family and set rank accordingly. Never guess a species to appear precise.
2. For each organism, give "evidence": the specific visible or audible field marks you used (for example "red wattles, metallic blue neck, ocellated train").
3. Confidence: "high" means diagnostic features are clearly visible or audible. "medium" means likely but look-alikes are possible. "low" means poor view, partial subject or many look-alikes. Overall confidence is that of the primary organism.
4. Do not infer or state a location from the media. Do not describe people. If people are visible, set peopleVisible=true.
5. "ecologic": 2–4 sentences on behaviour and ecology, written as observation then interpretation. Say "likely" or "possibly" when interpreting behaviour. Do not mention that this is a photo, video or recording.
6. Safety flags: fungi=true for any fungus. dangerous=true for venomous, toxic or dangerous organisms. sensitiveSpecies=true for threatened (IUCN VU/EN/CR), heavily poached or nesting-sensitive species whose exact location should not be shared. isNatureSubject=false if there is no natural subject (for example a screenshot, document or indoor object).
7. safetyNote: one short sentence when fungi, dangerous or sensitiveSpecies is true (for example "Never eat wild mushrooms based on this ID."), otherwise "".
8. needsExpertReview=true when confidence is low, when look-alikes are dangerous (for example toxic fungi or venomous snakes), or when the species is rare for typical observations.
9. hashtags: 3–6 lowercase tags without '#': common and scientific names (spaces removed) plus one habitat or behaviour tag.`;

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    identifications: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          commonName: { type: Type.STRING },
          scientificName: { type: Type.STRING },
          rank: { type: Type.STRING, enum: ['species', 'genus', 'family', 'order', 'class', 'kingdom', 'other'] },
          confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
          evidence: { type: Type.STRING },
        },
        required: ['commonName', 'scientificName', 'rank', 'confidence', 'evidence'],
      },
    },
    overallConfidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
    ecologic: { type: Type.STRING },
    hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
    flags: {
      type: Type.OBJECT,
      properties: {
        isNatureSubject: { type: Type.BOOLEAN },
        fungi: { type: Type.BOOLEAN },
        dangerous: { type: Type.BOOLEAN },
        sensitiveSpecies: { type: Type.BOOLEAN },
        peopleVisible: { type: Type.BOOLEAN },
      },
      required: ['isNatureSubject', 'fungi', 'dangerous', 'sensitiveSpecies', 'peopleVisible'],
    },
    needsExpertReview: { type: Type.BOOLEAN },
    safetyNote: { type: Type.STRING },
  },
  required: ['identifications', 'overallConfidence', 'ecologic', 'hashtags', 'flags', 'needsExpertReview', 'safetyNote'],
};

const normalize = (raw: any, location?: string): AnalysisResult => {
  const ids: Identification[] = (Array.isArray(raw?.identifications) ? raw.identifications : [])
    .filter((i: any) => i && (i.commonName || i.scientificName))
    .slice(0, 6)
    .map((i: any) => ({
      commonName: String(i.commonName || i.scientificName).trim().slice(0, 80),
      scientificName: String(i.scientificName || '').trim().slice(0, 80),
      rank: i.rank || 'other',
      confidence: (['high', 'medium', 'low'].includes(i.confidence) ? i.confidence : 'low') as Confidence,
      evidence: String(i.evidence || '').slice(0, 300),
    }));
  const confidence: Confidence = ['high', 'medium', 'low'].includes(raw?.overallConfidence) ? raw.overallConfidence : (ids[0]?.confidence || 'low');
  const flags: AnalysisFlags = {
    isNatureSubject: raw?.flags?.isNatureSubject !== false,
    fungi: !!raw?.flags?.fungi,
    dangerous: !!raw?.flags?.dangerous,
    sensitiveSpecies: !!raw?.flags?.sensitiveSpecies,
    peopleVisible: !!raw?.flags?.peopleVisible,
  };
  const taxonomy = ids.map(i => i.commonName);
  if (ids[0]?.scientificName && ids[0].scientificName.toLowerCase() !== ids[0].commonName.toLowerCase()) {
    taxonomy.splice(1, 0, ids[0].scientificName);
  }
  const tags = new Set<string>((Array.isArray(raw?.hashtags) ? raw.hashtags : []).map((t: string) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).filter(Boolean));
  ids.slice(0, 2).forEach(i => {
    [i.commonName, i.scientificName].forEach(n => { const t = n.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); if (t) tags.add(t); });
  });
  return {
    taxonomy: taxonomy.length ? taxonomy : [],
    ecologic: String(raw?.ecologic || '').trim().slice(0, 2000),
    hashtags: [...tags].slice(0, 8),
    location: location && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location) ? location : '',
    confidence,
    identifications: ids,
    flags,
    needsExpertReview: !!raw?.needsExpertReview || confidence === 'low',
    safetyNote: String(raw?.safetyNote || '').slice(0, 200),
    model: MODEL_IDENTIFY,
    promptVersion: AI_PROMPT_VERSION,
  };
};

async function identify(parts: any[], context: string, location?: string): Promise<AnalysisResult> {
  const total = parts.reduce((n, p) => n + (p.inlineData?.data?.length || 0) * 0.75, 0);
  if (total > MAX_INLINE_BYTES) throw new AiError('This file is too large to analyse. Try a shorter clip.', 'too_large');
  const ai = await client();
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: MODEL_IDENTIFY,
      contents: { parts: [...parts, { text: `${context}${location && !/^-?\d/.test(location) ? `\nThe explorer is near: ${location} (use only to consider plausible species, never repeat it as fact).` : ''}` }] },
      config: {
        systemInstruction: IDENTIFY_INSTRUCTIONS,
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_SCHEMA as any,
        temperature: 0.2,
      },
    });
    let raw: any;
    try { raw = JSON.parse(response.text || '{}'); } catch { throw new AiError('The AI returned an unreadable answer.', 'invalid'); }
    const result = normalize(raw, location);
    if (!result.taxonomy.length && result.flags.isNatureSubject) throw new AiError('No organism could be identified.', 'invalid');
    return result;
  });
}

export const GenAiService = {
  /** Identify organisms in a single photo, video or sound. Throws AiError on failure. */
  analyzeMedia: async (blob: Blob, type: 'audio' | 'image' | 'video', location?: string): Promise<AnalysisResult> => {
    const data = await toBase64(blob);
    const ctx = type === 'audio'
      ? 'Identify the sources of the sounds in this field recording (species by call or song where possible).'
      : type === 'video'
        ? 'Identify the organisms in this field video using both what is seen and heard, and describe the behaviour shown.'
        : 'Identify the organisms in this field photo and describe what they are doing.';
    return identify([{ inlineData: { data, mimeType: blob.type || (type === 'image' ? 'image/jpeg' : type === 'audio' ? 'audio/webm' : 'video/webm') } }], ctx, location);
  },

  /** Identify from a recording plus key frames (photos taken during the recording). */
  analyzeMultimodal: async (mediaBlob: Blob | null, imageBlobs: Blob[], location?: string): Promise<AnalysisResult> => {
    const parts: any[] = [];
    if (mediaBlob) parts.push({ inlineData: { data: await toBase64(mediaBlob), mimeType: mediaBlob.type } });
    for (const img of imageBlobs.slice(0, 4)) parts.push({ inlineData: { data: await toBase64(img), mimeType: img.type || 'image/jpeg' } });
    if (!parts.length) throw new AiError('Nothing to analyse.', 'invalid');
    return identify(parts, 'Identify the organisms using the recording first (sounds and movement), and the key-frame photos to confirm visual features. Describe the behaviour.', location);
  },

  /**
   * Structured ethological / bioacoustic descriptors for the research dataset.
   * Returns null on failure. Never fabricates placeholder measurements.
   */
  generateEthologicalDescriptors: async (
    labels: string[], behavior: string, mediaType: 'image' | 'video' | 'audio', _locationArea?: string
  ): Promise<EthologicalDescriptors | null> => {
    if (!labels.length) return null;
    try {
      const ai = await client();
      return await withRetry(async () => {
        const response = await ai.models.generateContent({
          model: 'ng-describe',
          contents: `Give general, literature-level ethological descriptors for these organisms. These describe the species, not measurements of this recording.
Organisms: ${labels.slice(0, 4).join(', ')}
Observed behaviour notes: ${behavior.slice(0, 600)}
Media type: ${mediaType}
Use "unknown" for any field you are not confident about. Never invent precise numbers. Give frequency ranges only if the species' vocal range is well documented.`,
          config: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                bioacousticProfile: { type: Type.OBJECT, properties: { frequencyRangeHz: { type: Type.STRING }, vocalizationType: { type: Type.STRING }, callRhythmPattern: { type: Type.STRING } } },
                visualEthology: { type: Type.OBJECT, properties: { motionPosture: { type: Type.STRING }, diagnosticMarkings: { type: Type.ARRAY, items: { type: Type.STRING } } } },
                habitatNiche: { type: Type.OBJECT, properties: { microHabitat: { type: Type.STRING }, environmentalContext: { type: Type.STRING } } },
              },
            } as any,
          },
        });
        const parsed = JSON.parse(response.text || '{}');
        return { ...parsed, aiDescriptorVersion: `describe-2026.11-1/${'ng-describe'}` } as EthologicalDescriptors;
      }, 2);
    } catch {
      return null;
    }
  },

  /**
   * Persona-based feed curation: ranks candidates for an explorer's naturalist persona and
   * writes short, factual curator notes. On failure, returns the input order without notes.
   */
  curateAgenticFeed: async (persona: NaturalistPersona, candidatePosts: CommunityPost[]): Promise<CommunityPost[]> => {
    if (!candidatePosts?.length) return [];
    const pool = candidatePosts.slice(0, 15);
    try {
      const ai = await client();
      const summary = pool.map(p => `[${p.id}] ${p.labels?.slice(0, 3).join(', ') || 'unidentified'} | ${p.mediaType} | ${(p.caption || p.behavior || '').slice(0, 140)}`).join('\n');
      const result = await withRetry(async () => {
        const response = await ai.models.generateContent({
          model: 'ng-curate',
          contents: `Explorer persona: archetype "${persona.archetype || 'Explorer'}"; interests: ${(persona.taxaInterests || []).join(', ') || 'all taxa'}; styles: ${(persona.observationStyles || []).join(', ') || 'all'}; habitats: ${(persona.habitatAffinities || []).join(', ') || 'all'}; focus: ${persona.customFocus || 'none'}.
Rank the most relevant sightings (up to 12) for this explorer. For each, write one factual sentence (no emojis, no invented facts beyond the listed details) on why it matches.
Sightings:\n${summary}`,
          config: {
            temperature: 0.3,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: { curatedItems: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { postId: { type: Type.STRING }, curatorNote: { type: Type.STRING }, relevanceScore: { type: Type.NUMBER } }, required: ['postId', 'curatorNote', 'relevanceScore'] } } },
              required: ['curatedItems'],
            } as any,
          },
        });
        return JSON.parse(response.text || '{}');
      }, 2);
      const map = new Map<string, { note: string; score: number }>();
      (result.curatedItems || []).forEach((i: any) => { if (i?.postId && i.curatorNote) map.set(i.postId, { note: String(i.curatorNote).replace(/\p{Extended_Pictographic}/gu, '').trim().slice(0, 220), score: Number(i.relevanceScore) || 0 }); });
      const ranked = pool.filter(p => map.has(p.id)).sort((a, b) => map.get(b.id)!.score - map.get(a.id)!.score).map(p => ({ ...p, curatorNote: map.get(p.id)!.note }));
      const rest = candidatePosts.filter(p => !map.has(p.id));
      return [...ranked, ...rest];
    } catch {
      return candidatePosts;
    }
  },

  /** Title + summary for a multi-capture post. Throws on failure (caller falls back to no title). */
  synthesizeCollection: async (items: { taxonomy: string[], ecologic: string }[]): Promise<{ title: string, description: string }> => {
    const ai = await client();
    const summaryText = items.map((i, idx) => `Sighting ${idx + 1}: ${i.taxonomy.join(', ') || 'unidentified'}. ${i.ecologic}`).join('\n');
    return withRetry(async () => {
      const response = await ai.models.generateContent({
        model: MODEL_SYNTHESIZE,
        contents: `Write a short title (max 8 words) and a 2–3 sentence summary for this set of nature sightings from one outing. Use only the facts given and do not add species or claims.\n${summaryText}`,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          responseSchema: {
            type: Type.OBJECT,
            properties: { title: { type: Type.STRING }, description: { type: Type.STRING } },
            required: ['title', 'description'],
          },
        },
      });
      const r = JSON.parse(response.text || '{}');
      if (!r.title) throw new AiError('No summary produced.', 'invalid');
      return { title: String(r.title).slice(0, 120), description: String(r.description || '').slice(0, 1000) };
    }, 2);
  },
};
