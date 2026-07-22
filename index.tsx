
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.tsx';

// Error monitoring — inert unless VITE_SENTRY_DSN is set (nothing to send
// errors to otherwise). Set it in your deploy environment to enable.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // Errors only, no performance/session-replay sampling — keep this
    // lightweight until there's a reason to pay for more signal.
    tracesSampleRate: 0,
  });
} else {
  console.debug('[Sentry] VITE_SENTRY_DSN not set — error monitoring disabled.');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
