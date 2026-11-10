import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { initAnalytics } from './services/analytics.ts';
import { ThemeService } from './services/themeService.ts';
import { getDailyTheme } from './constants/naturalists.ts';

initAnalytics();

// /theme-init.js has already painted the fortnight's colours; this adds the favicon and the
// browser chrome before React renders. An admin override (if any) refines it once loaded.
try { ThemeService.applyThemeToDOM(getDailyTheme()); } catch { /* keep the first-paint palette */ }

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary label="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker registration failed', e));
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
  }
}
