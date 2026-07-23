// W2: extracted from firebaseService.ts — Gemini runtime config
// (admin-editable model/system-prompt) and the daily naturalist theme
// cache in Firestore.
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { GeminiConfig } from "../../types";
import { DailyTheme } from "../themeService";
import { DEFAULT_CONFIG } from "./shared";

export const ConfigService = {
  getGeminiConfig: async (): Promise<GeminiConfig> => {
    try {
      const docRef = doc(db, "admin_config", "gemini_state");
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as GeminiConfig;
        // Migration: Update old model name to supported version
        if (data.model && (data.model.includes('gemini-2.5-flash-native') || data.model === 'gemini-2.0-flash')) {
          data.model = 'gemini-2.5-flash-native-audio-latest';
          await updateDoc(docRef, { model: data.model });
        }
        return data;
      } else {
        await setDoc(docRef, DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
      }
    } catch (e) {
      return DEFAULT_CONFIG;
    }
  },

  updateGeminiConfig: async (config: Partial<GeminiConfig>) => {
    const docRef = doc(db, "admin_config", "gemini_state");
    await setDoc(docRef, config, { merge: true });
  },

  getDailyTheme: async (dateStr: string): Promise<DailyTheme | null> => {
    try {
      const docRef = doc(db, "daily_themes", dateStr);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as DailyTheme;
      }
      return null;
    } catch (e) {
      console.error("Error fetching daily theme:", e);
      return null;
    }
  },

  saveDailyTheme: async (dateStr: string, theme: DailyTheme) => {
    try {
      const docRef = doc(db, "daily_themes", dateStr);
      await setDoc(docRef, theme);
    } catch (e) {
      console.error("Error saving daily theme:", e);
    }
  },
};
