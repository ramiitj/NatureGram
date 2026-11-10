import { applyThemeMark, startBranding } from './brandMark';
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
          // Stored theme docs carry a copy of the colours from when they were seeded. The designed
          // palettes in constants/palettes.json win, unless an admin deliberately overrides them
          // (colorsOverride: true on the theme doc).
          // The photograph and its credit travel together: the chosen, attributed photo in
          // constants/naturalists.ts wins over an older stored copy unless an admin overrides it
          // (imageOverride: true, ideally with its own imageCredit).
          const { colors: storedColors, colorsOverride, imageUrl: storedImage, imageCredit: storedCredit, imageOverride, ...rest } = data as any;
          const useStoredImage = imageOverride === true && !!storedImage;
          mergedTheme = {
            ...mergedTheme,
            ...rest,
            imageUrl: useStoredImage ? storedImage : (mergedTheme.imageUrl || storedImage),
            imageCredit: useStoredImage ? storedCredit : mergedTheme.imageCredit,
            colors: colorsOverride === true && storedColors ? { ...mergedTheme.colors, ...storedColors } : mergedTheme.colors
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

  /**
   * Paint the fortnight's palette into the CSS variables. The four tones are designed per naturalist
   * (constants/palettes.json) and already meet their contrast rules; the darkening below is only a
   * safety net for older or admin-overridden colours.
   */
  applyThemeToDOM: (theme: Pick<DailyTheme, 'colors'> & Partial<DailyTheme>) => {
    const root = document.documentElement;
    const toRgb = (hex: string | undefined): [number, number, number] | null => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
    };
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a: number[], b: number[]) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
    const BG = [252, 250, 248];
    const WHITE = [255, 255, 255];
    // Safety net: darken until the colour reaches the target contrast against a reference
    const ensureContrast = (rgb: [number, number, number], target: number, against: number[] = BG): [number, number, number] => {
      let c = [...rgb] as [number, number, number];
      for (let i = 0; i < 40 && contrast(c, against) < target; i++) c = c.map(v => Math.max(0, Math.round(v * 0.92))) as [number, number, number];
      return c;
    };
    const str = (c: number[]) => `${c[0]} ${c[1]} ${c[2]}`;
    const hex = (c: number[]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    const c = theme.colors;

    // primary: buttons (white text >= 4.5:1), also read as text on the cream page (>= 4.5:1)
    const primaryRaw = toRgb(c.primary) || [87, 83, 78];
    const primary = ensureContrast(ensureContrast(primaryRaw, 4.5, WHITE), 4.5);
    // deep: text and headings (>= 7:1); older themes without it start from the primary
    const deep = ensureContrast(toRgb(c.deep) || primary, 7);
    // accent: highlights (>= 4.5:1)
    const accent = ensureContrast(toRgb(c.accent) || primary, 4.5);
    // vivid: decorative glows only; older themes used the raw accent here
    const vivid = toRgb(c.vivid) || toRgb(c.accent) || primaryRaw;

    root.style.setProperty('--theme-primary', hex(primary));
    root.style.setProperty('--theme-primary-rgb', str(primary));
    root.style.setProperty('--theme-primary-gradient', c.primaryGradient || hex(vivid));
    root.style.setProperty('--theme-shadow', c.shadow || hex(deep));
    root.style.setProperty('--theme-shadow-rgb', str(toRgb(c.shadow) || deep));
    root.style.setProperty('--theme-text', c.text || '#ffffff');
    root.style.setProperty('--theme-deep-rgb', str(deep));
    root.style.setProperty('--theme-accent', `rgb(${accent.join(',')})`);
    root.style.setProperty('--theme-accent-rgb', str(accent));
    root.style.setProperty('--theme-vivid-rgb', str(vivid));
    root.style.setProperty('--theme-accent-vivid-rgb', str(vivid));
    // Newsreader is the only display face loaded; older stored themes may name fonts that aren't
    root.style.setProperty('--font-display', '"Newsreader", Georgia, serif');

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', hex(deep));
    // The favicon and home-screen icon wear the fortnight's colours too
    applyThemeMark(c);
    startBranding();
  },

  getDailyTheme: async (): Promise<DailyTheme | null> => {
    const stored = localStorage.getItem('daily_theme_v7');
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
      localStorage.setItem('daily_theme_v7', JSON.stringify(theme));
    }
    return theme;
  }
};

