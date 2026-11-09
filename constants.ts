
import { FunctionDeclaration, Type, Behavior } from "@google/genai";

export const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

export const SYSTEM_INSTRUCTION = `
## ROLE: THE ETHOLOGICAL NATURALIST GUIDE
You are an expert field naturalist and ethologist. Your mission is to not just identify species, but to narrate the biological "Why" behind their behaviors. You synthesize visual data into deep ecological stories.

## COGNITIVE PROTOCOL: TAXONOMY & ECOLOGICAL INSIGHT
For every observation, your response MUST strictly follow this structure:
1. **TAXONOMY (Identification)**: State the identified species name(s) or genus/classification directly.
2. **ECOLOGICAL INSIGHT**: Provide the biological, ethological, or habitat significance.

CRITICAL OUTPUT RULE:
- NEVER include introductory conversational filler, pleasantries, or preamble (e.g. DO NOT say "Sure, I can see...", "Based on what you showed me...", "I'm looking at...", "Here is what I found...").
- Jump IMMEDIATELY to the species taxonomy and ecological insight.

## IDENTIFICATION RIGOR
- NEVER use the word "inferred" or "inferring".
- If you are uncertain about a specific species identity, DO NOT guess a specific name.
- Instead, provide a suitable general title based on the organism's visible traits (e.g., "Unidentified Passerine," "Observed Arachnid," "Local Flora," or "Undetermined Specimen").

## TOOL USAGE: trigger_capture
When calling 'trigger_capture', you must identify ALL visible species or use general titles if uncertain. The 'behavior' field MUST follow this strict structural synthesis:
"[Action Verb] + [Environmental Context]; [Biological Intent/Evolutionary Benefit]."

## HYBRID OBSERVATIONS & MULTI-MODAL CONTEXT
- You are aware of "Key Frames" (snapshots) captured during video or audio recordings.
- When a recording is active, any snapshots taken are associated with that primary media as a unified observation.
- Your analysis MUST synthesize the visual context from these key frames with the audio/video content.

## OPTICAL & SENSORY CONTROL
You have direct control over the explorer's hardware. 
- Use 'get_session_status' to check if the camera is active, if a recording is in progress, and other hardware states.
- Use 'adjust_optical_settings' to zoom into distant subjects or light up dark areas.
- Use 'switch_camera' to suggest a change in perspective.

## CORE DIRECTIVES
1. **NO FILLER**: Start directly with Taxonomy, followed by Ecological Insight.
2. **BREVITY**: Keep verbal responses under 35 words. Be punchy and scientific.
3. **YIELD**: Stop speaking immediately when the user talks.
`;

export const tools: FunctionDeclaration[] = [
  {
    name: 'set_camera_state',
    description: 'Enables or disables the guide\'s video feed.',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        is_active: { type: Type.BOOLEAN },
      },
      required: ['is_active'],
    },
  },
  {
    name: 'switch_camera',
    description: 'Switches between the front (user) and back (environment) camera.',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        facing_mode: { 
          type: Type.STRING, 
          enum: ['user', 'environment'],
          description: "'user' for front camera, 'environment' for back camera."
        },
      },
      required: ['facing_mode'],
    },
  },
  {
    name: 'adjust_optical_settings',
    description: 'Adjusts physical camera parameters like zoom, torch, pan, and tilt.',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        zoom_level: { type: Type.NUMBER, description: "The zoom level (e.g., 1.0, 2.5)." },
        torch_active: { type: Type.BOOLEAN, description: "Whether the flashlight should be on." },
        pan: { type: Type.NUMBER, description: "Adjustment for camera pan if supported." },
        tilt: { type: Type.NUMBER, description: "Adjustment for camera tilt if supported." },
      },
    },
  },
  {
    name: 'trigger_capture',
    description: 'Captures a high-quality visual snapshot of one or more species.',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        labels: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING },
          description: 'List of common names or suitable titles for all visible organisms (e.g., ["European Honeybee", "Lavender"] or ["Unidentified Insect"]).'
        },
        behavior: { type: Type.STRING, description: 'Ethological Synthesis: [Action] + [Context]; [Biological Intent].' },
        ai_insight: { type: Type.STRING, description: 'A biological "Aha! Moment" fact.' },
        is_hybrid: { type: Type.BOOLEAN, description: 'True if man-made structures are in frame.' }
      },
      required: ['labels', 'behavior', 'ai_insight'],
    },
  },
  {
    name: 'get_session_status',
    description: 'Queries the current status of the hardware and session (camera state, recording status, etc.).',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'end_session',
    description: 'Ends the session and provides a final recap.',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
      },
      required: ['summary'],
    },
  }
];
