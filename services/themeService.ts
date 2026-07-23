import { NaturalistTheme, getDailyTheme } from '../constants/naturalists';
import { db, storage } from '../firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getCorsProxyUrl } from './firebaseService';

export interface DailyTheme extends NaturalistTheme {
  date: string;
  searchQuery: string;
  fontFamily: string;
  status?: 'generating' | 'ready';
}

export const ThemeService = {
  generateDynamicTheme: async (): Promise<DailyTheme | null> => {
    try {
      const naturalistTheme = getDailyTheme();
      let mergedTheme = { ...naturalistTheme };

      try {
        const themeDocRef = doc(db, 'themes', naturalistTheme.id);
        const themeDocSnap = await getDoc(themeDocRef);
      
        if (themeDocSnap.exists()) {
          const data = themeDocSnap.data();
          mergedTheme = {
            ...mergedTheme,
            ...data,
            colors: data.colors ? { ...mergedTheme.colors, ...data.colors } : mergedTheme.colors
          };
        } else {
          try {
            await setDoc(themeDocRef, {
              id: mergedTheme.id,
              naturalist: mergedTheme.naturalist,
              quote: mergedTheme.quote,
              locationName: mergedTheme.locationName,
              locationCaption: mergedTheme.locationCaption,
              imageUrl: mergedTheme.imageUrl || "",
              colors: mergedTheme.colors,
              updatedAt: new Date().toISOString()
            });
            console.log(`Auto-seeded theme ${mergedTheme.id} to Firestore`);
          } catch (seedErr) {
            console.warn("Could not auto-seed theme details (silent on landing):", seedErr);
          }
        }
      } catch (fbError) {
        console.warn("Firebase theme fetch skipped due to error (e.g. auth):", fbError);
      }

      const newTheme: DailyTheme = {
        date: new Date().toISOString(),
        ...mergedTheme,
        searchQuery: "",
        // V1: the app's own font pairing (see tailwind.config.js) — this
        // used to hardcode "Space Grotesk, sans-serif" here, one of the
        // exact "safe AI-app" font choices this pillar moved away from,
        // silently overriding index.css's own default for any bare
        // (un-Tailwind-classed) heading element.
        fontFamily: "Fraunces, serif",
        status: 'ready'
      };

      return newTheme;
    } catch (e) {
      console.error("Failed to generate static theme:", e);
      return null;
    }
  },

  seedAllThemes: async (): Promise<void> => {
    try {
        const { NATURALIST_THEMES } = await import('../constants/naturalists');
        for (const theme of NATURALIST_THEMES) {
            const themeDocRef = doc(db, 'themes', theme.id);
            const snap = await getDoc(themeDocRef);
            if (!snap.exists() || snap.data().imageUrl !== theme.imageUrl) {
               await setDoc(themeDocRef, {
                  id: theme.id,
                  naturalist: theme.naturalist,
                  quote: theme.quote,
                  locationName: theme.locationName,
                  locationCaption: theme.locationCaption,
                  imageUrl: theme.imageUrl,
                  colors: theme.colors,
                  updatedAt: new Date().toISOString()
               }, { merge: true });
            }
        }
    } catch(e) {
       console.warn("Auto-seeding full collection failed", e);
    }
  },

  applyThemeToDOM: (theme: DailyTheme) => {
    const root = document.documentElement;
    
    // Helper to convert hex to rgb string "r g b"
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? 
        `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}` : 
        null;
    };

    root.style.setProperty('--theme-primary', theme.colors.primary);
    root.style.setProperty('--theme-primary-gradient', theme.colors.primaryGradient);
    root.style.setProperty('--theme-shadow', theme.colors.shadow);
    root.style.setProperty('--theme-text', theme.colors.text);
    root.style.setProperty('--font-display', theme.fontFamily);
    
    const primaryRgb = hexToRgb(theme.colors.primary);
    if (primaryRgb) root.style.setProperty('--theme-primary-rgb', primaryRgb);
    
    const shadowRgb = hexToRgb(theme.colors.shadow);
    if (shadowRgb) root.style.setProperty('--theme-shadow-rgb', shadowRgb);
    
    if (theme.colors.accent) {
      root.style.setProperty('--theme-accent', theme.colors.accent);
      const accentRgb = hexToRgb(theme.colors.accent);
      if (accentRgb) root.style.setProperty('--theme-accent-rgb', accentRgb);
    }
  },

  getDailyTheme: async (): Promise<DailyTheme | null> => {
    const stored = localStorage.getItem('daily_theme_v5');
    if (!stored) return null;
    try {
      const theme = JSON.parse(stored);
      // Check if it's still today
      const themeDate = new Date(theme.date).toDateString();
      const today = new Date().toDateString();
      // Ensure the ID matches the current expected theme. If not, it means the 15 day period might have shifted
      // However sticking to daily check is fine. It will refresh automatically when date changes
      if (themeDate === today) {
        if (!theme.imageUrl) {
          return null;
        }
        return theme;
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  generateAndSaveDailyTheme: async (): Promise<DailyTheme | null> => {
    const theme = await ThemeService.generateDynamicTheme();
    if (theme) {
      localStorage.setItem('daily_theme_v5', JSON.stringify(theme));
    }
    return theme;
  }
};

