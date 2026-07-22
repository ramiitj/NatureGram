/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Sentry from '@sentry/node';

// Error monitoring — inert unless SENTRY_DSN is set (nothing to send
// errors to otherwise).
//
// Note: this is an ESM module, and static imports elsewhere in server.js
// are already resolved by the time any of our own code runs, so Sentry
// can't retroactively auto-instrument modules (http, express) that loaded
// before this call — full auto-instrumentation in ESM needs a `--import`
// preload flag at process startup instead. This intentionally stays
// simple: basic uncaught-exception/unhandled-rejection capture (which
// Sentry.init sets up on its own), not full request tracing.
// Returns true if Sentry actually initialized (DSN present), so callers
// know whether it's meaningful to also call Sentry.setupExpressErrorHandler.
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry] SENTRY_DSN not set — server-side error monitoring disabled.');
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
  });
  console.log('[Sentry] Server-side error monitoring initialized.');
  return true;
}

export { Sentry };
