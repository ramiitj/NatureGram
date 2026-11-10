/**
 * Firebase App Check for the AI and publishing routes.
 *
 * The app sends `X-Firebase-AppCheck: <token>` (reCAPTCHA Enterprise / v3 on the web) on calls to
 * /api-proxy, /api/publish, /api/posts/:id/visibility and /api/live/*. For the live websocket,
 * where browsers cannot set headers, the token travels as a path segment:
 * /api-proxy/ac/<token>/ws/... (stripped before the request reaches Gemini).
 *
 *  - APPCHECK_ENFORCE=true  → a missing or invalid token is refused (401).
 *  - otherwise (default)     → the request goes ahead and the outcome is counted and logged
 *                              (monitoring mode), so the owner can see coverage before enforcing.
 *
 * Native apps (Capacitor) do not have an App Check provider yet, so they send no token: do not
 * enforce until they do, or they will lose AI and publishing. See docs/OPERATIONS.md.
 */
import crypto from 'crypto';
import { getAppCheck } from 'firebase-admin/app-check';

export const APPCHECK_ENFORCE = process.env.APPCHECK_ENFORCE === 'true';
const counts = { ok: 0, missing: 0, invalid: 0 };
const verified = new Map(); // sha256(token) -> exp ms (verification is cached until the token expires)

export const appCheckStats = () => ({ mode: APPCHECK_ENFORCE ? 'enforced' : 'monitoring', ...counts });

/** Returns 'ok' | 'missing' | 'invalid'. */
export async function checkAppCheckToken(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) return 'missing';
  const key = crypto.createHash('sha256').update(token).digest('base64url');
  const exp = verified.get(key);
  if (exp && exp > Date.now()) return 'ok';
  try {
    const res = await getAppCheck().verifyToken(token);
    const until = Math.min(Date.now() + 30 * 60_000, (Number(res?.token?.exp) || 0) * 1000);
    if (verified.size > 5000) verified.clear();
    verified.set(key, until);
    return 'ok';
  } catch {
    return 'invalid';
  }
}

/** Decide and count. Returns null to go ahead, or { status, message } to refuse. */
export async function appCheckVerdict(token, { log, route, uid = null } = {}) {
  const outcome = await checkAppCheckToken(token);
  counts[outcome]++;
  if (outcome !== 'ok') {
    log?.(APPCHECK_ENFORCE ? 'warn' : 'info', 'appcheck', { outcome, route, enforced: APPCHECK_ENFORCE, uid });
    if (APPCHECK_ENFORCE) return { status: 401, message: 'This app could not be verified. Please update NatureGram or reload the page.' };
  }
  return null;
}

/** Express middleware for HTTP routes. */
export const appCheckMiddleware = (log, route) => async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const verdict = await appCheckVerdict(req.headers['x-firebase-appcheck'], { log, route: route || req.path });
  if (verdict) return res.status(verdict.status).json({ ok: false, code: 'appcheck', message: verdict.message, error: { code: verdict.status, message: verdict.message } });
  next();
};

/** Pull an App Check token out of a websocket path (/ac/<token>/...) and return the cleaned path. */
export function splitWsAppCheck(relPath) {
  const m = /^\/ac\/([A-Za-z0-9._-]{20,4096})(\/.*)$/.exec(relPath || '');
  return m ? { token: m[1], path: m[2] } : { token: null, path: relPath };
}
