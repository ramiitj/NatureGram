/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// W1: structured logging — every log line is one JSON object on stdout/
// stderr instead of a free-text string. This is what actually makes
// "observability" real rather than aspirational: Cloud Run/Cloud Logging
// (and any other log drain) auto-parses JSON stdout into structured,
// filterable/queryable fields — e.g. `jsonPayload.requestId="..."` — the
// same way console.log("[Proxy] ...") strings never could be.
function emit(level, message, fields) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  info: (message, fields) => emit('info', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  error: (message, fields) => emit('error', message, fields),
};

// Per-request tracing: a single correlation ID threaded through every log
// line for one request's lifecycle (auth check, upstream call, outcome),
// so its full path can be reconstructed from logs alone — the lightweight,
// dependency-free form of "tracing" this app needs, short of standing up
// a full OpenTelemetry collector.
export function newRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// One line per completed request, carrying exactly the fields W1 asks
// for: model, latency, and outcome (confidence isn't visible at this
// layer — the proxy relays opaque bytes to/from Gemini, it doesn't parse
// them; see services/tracingService.ts for the client-side counterpart
// that captures confidence once the response is actually parsed).
export function logRequestTrace({ requestId, route, uid, model, latencyMs, outcome, error }) {
  logger.info('request_trace', {
    requestId,
    route,
    uid: uid || null,
    model: model || null,
    latencyMs,
    outcome,
    error: error || undefined,
  });
}
