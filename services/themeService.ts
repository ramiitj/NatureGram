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
        }
      } catch (fbError) {
        console.warn("Firebase theme fetch skipped due to error (e.g. auth):", fbError);
      }

      const newTheme: DailyTheme = {
        date: new Date().toISOString(),
        ...mergedTheme,
        searchQuery: "",
        fontFamily: "Space Grotesk, sans-serif",
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
    const toRgb = (hex: string): [number, number, number] | null => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
    };
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a: number[], b: number[]) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
    // Darken a colour until it reaches the target contrast against the light app background
    const BG = [252, 250, 248];
    const ensureContrast = (rgb: [number, number, number], target = 4.5): [number, number, number] => {
      let c = [...rgb] as [number, number, number];
      for (let i = 0; i < 40 && contrast(c, BG) < target; i++) c = c.map(v => Math.max(0, Math.round(v * 0.92))) as [number, number, number];
      return c;
    };
    const str = (c: number[]) => `${c[0]} ${c[1]} ${c[2]}`;

    root.style.setProperty('--theme-primary', theme.colors.primary);
    root.style.setProperty('--theme-primary-gradient', theme.colors.primaryGradient);
    root.style.setProperty('--theme-shadow', theme.colors.shadow);
    root.style.setProperty('--theme-text', theme.colors.text);
    root.style.setProperty('--font-display', theme.fontFamily?.includes('Space Grotesk') ? '"Playfair Display", serif' : (theme.fontFamily || '"Playfair Display", serif'));

    const primary = toRgb(theme.colors.primary);
    if (primary) root.style.setProperty('--theme-primary-rgb', str(ensureContrast(primary, 7)));
    const shadow = toRgb(theme.colors.shadow);
    if (shadow) root.style.setProperty('--theme-shadow-rgb', str(shadow));
    const accent = toRgb(theme.colors.accent || theme.colors.primaryGradient);
    if (accent) {
      const safe = ensureContrast(accent, 4.5);
      root.style.setProperty('--theme-accent', `rgb(${safe.join(',')})`);
      root.style.setProperty('--theme-accent-rgb', str(safe));
      root.style.setProperty('--theme-accent-vivid-rgb', str(accent));
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.colors.shadow || '#1c1917');
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

