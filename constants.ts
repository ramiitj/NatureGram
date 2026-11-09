
import { FunctionDeclaration, Type, Behavior } from "@google/genai";

export const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

export { SYSTEM_INSTRUCTION } from './constants/prompts';

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
