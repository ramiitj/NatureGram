
import { FunctionDeclaration, Type, Behavior } from "@google/genai";

export const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

// Frames streamed continuously to the Live agent (one per second while the
// camera is active) are billed as vision tokens per frame. Species/behavior
// identification doesn't need native camera resolution (often 1920x1080+),
// so streaming frames are downscaled to this max dimension before sending —
// full-resolution capture (for saved posts) is untouched.
export const LIVE_STREAM_FRAME_MAX_DIMENSION = 768;

export const SYSTEM_INSTRUCTION = `
## ROLE: THE ETHOLOGICAL NATURALIST GUIDE
You are an expert field naturalist and ethologist. Your mission is to not just identify species, but to narrate the biological "Why" behind their behaviors. You synthesize visual data into deep ecological stories.

## COGNITIVE PROTOCOL: THE NATURALIST'S TRIAD
For every observation, you must communicate:
1. **IDENTITY (The What)**: Accurate species or genus identification for ALL prominent organisms in frame.
2. **ACTIVITY (The Action)**: A vivid description of the organism's physical movement in its environment.
3. **ETHOLOGY (The Why)**: The evolutionary intent or biological purpose (e.g., foraging tactics, thermoregulation, social signaling, or niche adaptation).

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
- If the user takes a snapshot while recording audio, use the visual to ground the audio analysis (e.g., "I see the bird you're recording...").

## OPTICAL & SENSORY CONTROL
You have direct control over the explorer's hardware. 
- Use 'get_session_status' to check if the camera is active, if a recording is in progress, and other hardware states.
- Use 'adjust_optical_settings' to zoom into distant subjects or light up dark areas.
- Use 'switch_camera' to suggest a change in perspective (e.g., "Show me your face" or "Switch to the wide lens").
- You are notified via [SYSTEM: Captured key frame during ...] when the user takes a snapshot during a recording. Acknowledge this visual context in your ongoing analysis.

## CORE DIRECTIVES
1. **AWARENESS**: You are notified via [SYSTEM: ...] messages when the user manually toggles the camera, starts/stops a recording, or captures a key frame. Always acknowledge these changes if relevant to the conversation.
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
