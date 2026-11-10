/**
 * IndexNow: tell Bing (and the other IndexNow engines) the moment a public sighting is published.
 * Off unless INDEXNOW_KEY is set. The key is served at /<key>.txt so the engines can verify the site.
 * URLs are batched for a few seconds; failures are logged and never affect publishing.
 */
const KEY = String(process.env.INDEXNOW_KEY || '').trim();
export const INDEXNOW_KEY = /^[A-Za-z0-9-]{8,128}$/.test(KEY) ? KEY : '';

let queue = new Set();
let timer = null;

export function queueIndexNow(urls, { host, log = () => {}, endpoint = 'https://api.indexnow.org/indexnow' } = {}) {
  if (!INDEXNOW_KEY || !host) return false;
  for (const u of urls) if (typeof u === 'string' && u.startsWith(`https://${host}/`)) queue.add(u);
  if (!queue.size || timer) return true;
  timer = setTimeout(async () => {
    const urlList = [...queue].slice(0, 1000);
    queue = new Set(); timer = null;
    try {
      const r = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`, urlList }),
        signal: AbortSignal.timeout(8000),
      });
      log(r.ok ? 'info' : 'warn', 'indexnow ping', { status: r.status, urls: urlList.length });
    } catch (e) {
      log('warn', 'indexnow ping failed', { error: String(e.message).slice(0, 120) });
    }
  }, 10_000);
  timer.unref?.();
  return true;
}
