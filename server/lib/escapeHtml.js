/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Escapes a value for safe interpolation into HTML text/attribute contexts.
// Used on the /s/:postId share-preview route, which embeds Firestore-sourced
// (i.e. user-controlled) post fields directly into a server-rendered page.
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
