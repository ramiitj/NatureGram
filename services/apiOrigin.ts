/**
 * Where the NatureGram server lives. In the browser it's the page's own origin; inside the
 * native (Capacitor) apps the web assets are bundled locally, so API/AI calls go to production.
 */
const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
export const API_ORIGIN: string = isNative
  ? ((import.meta as any).env?.VITE_API_ORIGIN || 'https://thenaturegram.com')
  : (typeof window !== 'undefined' ? window.location.origin : '');
export const apiUrl = (path: string) => `${API_ORIGIN}${path}`;
