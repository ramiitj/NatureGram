/**
 * NatureGram's own account letters: email verification and password reset, sent through
 * server/mailer.js in the house hand instead of Firebase's default template.
 *
 *   POST /api/auth/send-verification   Authorization: Bearer <ID token of a signed-in, unverified explorer>
 *   POST /api/auth/send-reset          { email }   (no auth; always answers the same way)
 *
 * Both answer { sent: true } when our letter went out, or { sent: false, fallback: true } when the
 * app should ask Firebase to send its own email instead (no mail provider configured, or the
 * server's account can't generate action links: that needs roles/firebaseauth.admin).
 *
 * Links are generated with the Admin SDK and rebuilt on our origin:
 *   https://thenaturegram.com/auth/action?mode=verifyEmail&oobCode=…&continueUrl=…
 * Outcomes are logged; links, codes, tokens and email addresses never are.
 */
import crypto from 'crypto';
import express from 'express';
import { sendMail as defaultSendMail, letterHtml, letterText, mailConfigured as defaultMailConfigured, publicOrigin } from './mailer.js';

// The fortnight's naturalist, mirrored from constants/naturalists.ts (same order, same ~15.21-day
// rotation as getDailyTheme). server/test/authMail.test.mjs checks the two stay in step.
export const LETTER_NATURALISTS = [
  ['Jane Goodall', 'Only if we understand, will we care. Only if we care, will we help.', '#aed581'],
  ['Dian Fossey', 'When you realize the value of all life, you dwell less on what is past and concentrate more on the preservation of the future.', '#10b981'],
  ['Charles Darwin', 'It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.', '#a8a29e'],
  ['Alfred Russel Wallace', 'Nature seems to have taken every precaution that these, her choicest treasures, may not lose their value by being too easily obtained.', '#34d399'],
  ['John Muir', 'In every walk with nature one receives far more than he seeks.', '#3b82f6'],
  ['Rachel Carson', 'Those who contemplate the beauty of the earth find reserves of strength that will endure as long as life lasts.', '#06b6d4'],
  ['Henry David Thoreau', 'All good things are wild and free.', '#10b981'],
  ['Aldo Leopold', 'A thing is right when it tends to preserve the integrity, stability and beauty of the biotic community.', '#f59e0b'],
  ['Ralph Waldo Emerson', 'Adopt the pace of nature: her secret is patience.', '#f97316'],
  ['Wangari Maathai', 'When we plant trees, we plant the seeds of peace and seeds of hope.', '#84cc16'],
  ['David Attenborough', 'It seems to me that the natural world is the greatest source of excitement; the greatest source of visual beauty.', '#fbbf24'],
  ['Jacques-Yves Cousteau', 'The sea, once it casts its spell, holds one in its net of wonder forever.', '#38bdf8'],
  ['Alexander von Humboldt', 'Nature is a living whole, not a dead mass.', '#9ca3af'],
  ['Carl Linnaeus', 'If you do not know the names of things, the knowledge of them is lost too.', '#4ade80'],
  ['E.O. Wilson', 'Nature holds the key to our aesthetic, intellectual, cognitive and even spiritual satisfaction.', '#fb923c'],
  ['Sylvia Earle', 'No water, no life. No blue, no green.', '#60a5fa'],
  ['George Washington Carver', 'I love to think of nature as an unlimited broadcasting station, through which God speaks to us every hour.', '#f97316'],
  ['Mary Anning', 'The earth has music for those who listen.', '#9ca3af'],
  ['Steve Irwin', 'If we can teach people about wildlife, they will be touched. Share my wildlife with me.', '#fde047'],
  ['Robin Wall Kimmerer', 'Knowing that you love the earth changes you, activates you to defend and protect and celebrate.', '#86efac'],
  ['Maria Sibylla Merian', 'In my youth, I spent my time investigating insects.', '#f472b6'],
  ['Salim Ali', 'I suppose I have always been a watcher of birds.', '#c084fc'],
  ['Beatrix Potter', "There is something delicious about writing the first words of a story. You never quite know where they'll take you.", '#93c5fd'],
  ['John James Audubon', 'A true conservationist is a man who knows that the world is not given by his fathers, but borrowed from his children.', '#e879f9'],
];

export const letterNaturalist = (now = new Date()) => {
  const day = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const [name, quote, accent] = LETTER_NATURALISTS[Math.floor(day / 15.21) % LETTER_NATURALISTS.length];
  return { name, quote, accent: inkFor(accent) };
};

/** The accent, deepened until white button text on it reads clearly (WCAG 4.5:1). */
export function inkFor(hex) {
  let rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c) => { const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  for (let i = 0; i < 40 && 1.05 / (lum(rgb) + 0.05) < 4.5; i++) rgb = rgb.map(v => Math.round(v * 0.92));
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Rebuild a Firebase action link on our own origin. Firebase's link looks like
 * https://<project>.firebaseapp.com/__/auth/action?mode=…&oobCode=…&apiKey=…&continueUrl=…&lang=…
 * We keep only what our page needs, so the link is short and reads thenaturegram.com.
 */
export function rewriteActionLink(link, origin = publicOrigin()) {
  const src = new URL(link);
  const mode = src.searchParams.get('mode');
  const oobCode = src.searchParams.get('oobCode');
  if (!mode || !oobCode) throw new Error('not an action link');
  const out = new URL('/auth/action', origin);
  out.searchParams.set('mode', mode);
  out.searchParams.set('oobCode', oobCode);
  const cont = src.searchParams.get('continueUrl');
  if (cont) out.searchParams.set('continueUrl', cont);
  return out.toString();
}

/** A small sliding-window counter: allow(key) is false once `max` hits fall inside `windowMs`. */
export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return {
    allow(key, now = Date.now()) {
      const list = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (list.length >= max) { hits.set(key, list); return false; }
      list.push(now); hits.set(key, list);
      if (hits.size > 50_000) for (const [k, v] of hits) { if (!v.some(t => now - t < windowMs)) hits.delete(k); }
      return true;
    },
  };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// Errors that mean the server itself can't make links (role, config), not something about one address
const SETUP_ERROR = /insufficient-permission|permission|unauthorized|configuration|project-not-found|invalid-credential|internal-error|PERMISSION_DENIED/i;

export function verificationLetter({ username, link, naturalist = letterNaturalist() }) {
  const m = {
    preheader: 'One tap and your field notebook is yours.',
    heading: 'Your field notebook is waiting',
    paragraphs: [
      `Hi ${escapeName(username)},`,
      'Your notebook, your life list and your letters from other explorers are ready. Confirm this is your email and they are yours to keep.',
    ],
    button: { label: 'Confirm my email', url: link },
    after: ["If you didn't sign up, you can ignore this letter."],
    quote: { text: naturalist.quote, by: naturalist.name },
    accent: naturalist.accent,
    footnote: 'This link works once and expires in a few days. You can always ask for a new one from your profile.',
  };
  return { subject: 'Confirm your email and your field notebook is yours', html: letterHtml(m), text: letterText(m) };
}

export function resetLetter({ link, naturalist = letterNaturalist() }) {
  const m = {
    preheader: 'Choose a new password and pick up where you left off.',
    heading: 'A new password for your notebook',
    paragraphs: [
      'Someone, hopefully you, asked to reset the password for this NatureGram account.',
      'Choose a new one and your sightings, life list and letters will be right where you left them.',
    ],
    button: { label: 'Choose a new password', url: link },
    after: ["If you didn't ask, you can ignore this letter. Your password stays as it is."],
    quote: { text: naturalist.quote, by: naturalist.name },
    accent: naturalist.accent,
    footnote: 'This link works once and expires in about an hour.',
  };
  return { subject: 'Your NatureGram password reset', html: letterHtml(m), text: letterText(m) };
}

const escapeName = (s) => String(s || 'explorer').slice(0, 40).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param app express app
 * @param deps { verifyIdToken, bearer, clientIp, log, auth: () => AdminAuth,
 *               sendMail?, mailConfigured?, origin?, minResetMs? }
 */
/** Firebase's own reason for a failed link (no addresses, codes or links), for the log. */
const reasonOf = (e) => String(e?.message || '')
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
  .replace(/https?:\/\/\S+/g, '<url>')
  .replace(/oobCode=[^&\s"]+/g, 'oobCode=<code>')
  .slice(0, 300);

export function mountAuthMail(app, deps) {
  const { verifyIdToken, bearer, clientIp, log } = deps;
  const sendMail = deps.sendMail || defaultSendMail;
  const mailConfigured = deps.mailConfigured || defaultMailConfigured;
  const origin = () => (deps.origin || publicOrigin());
  const minResetMs = deps.minResetMs ?? 1200;

  const verifyByUid = makeLimiter(3, 3_600_000);
  const verifyByIp = makeLimiter(6, 3_600_000);
  const resetByEmail = makeLimiter(3, 3_600_000);
  const resetByIp = makeLimiter(8, 3_600_000);
  // After a failed send, every reset answer is "fall back" for a while, so a provider outage
  // doesn't make existing and unknown addresses answer differently
  let mailDownUntil = 0;
  const FALLBACK = { sent: false, fallback: true };
  const json = express.json({ limit: '4kb' });

  app.post('/api/auth/send-verification', json, async (req, res) => {
    let user;
    try { user = await verifyIdToken(String(bearer(req) || '')); } catch { return res.status(401).json({ error: 'Please sign in again.' }); }
    if (user.isAnonymous || !user.email) return res.status(400).json({ error: 'There is no email on this account yet.' });
    if (user.emailVerified) return res.json({ sent: false, verified: true });
    if (!verifyByIp.allow(clientIp(req)) || !verifyByUid.allow(user.uid)) {
      log('info', 'auth mail: verification rate-limited', { uid: user.uid });
      return res.status(429).json({ error: "We've sent a few already. Give the last one a little while, then try again." });
    }
    if (!mailConfigured()) { log('info', 'auth mail: verification fallback (no provider)', { uid: user.uid }); return res.json(FALLBACK); }
    let username = '';
    try {
      const record = await deps.auth().getUser(user.uid);
      if (record.emailVerified) return res.json({ sent: false, verified: true });
      username = record.displayName || '';
    } catch { /* fall through with the token's details */ }
    let link;
    try {
      link = rewriteActionLink(await deps.auth().generateEmailVerificationLink(user.email, { url: origin() + '/welcome' }), origin());
    } catch (e) {
      log('warn', 'auth mail: verification link failed, falling back', { uid: user.uid, code: e?.code || e?.errorInfo?.code || 'error', reason: reasonOf(e) });
      return res.json(FALLBACK);
    }
    const letter = verificationLetter({ username: username || user.email.split('@')[0], link });
    const r = await sendMail({ to: user.email, ...letter, tags: [{ name: 'kind', value: 'verify' }] });
    if (!r.sent) { log('warn', 'auth mail: verification send failed, falling back', { uid: user.uid, error: r.error }); return res.json(FALLBACK); }
    log('info', 'auth mail: verification sent', { uid: user.uid, id: r.id });
    res.json({ sent: true });
  });

  app.post('/api/auth/send-reset', json, async (req, res) => {
    const started = Date.now();
    // Every answer about an address takes at least minResetMs, so timing says nothing either
    const answer = async (body) => { const left = minResetMs + Math.random() * 300 - (Date.now() - started); if (left > 0) await wait(left); res.json(body); };
    if (!resetByIp.allow(clientIp(req))) return res.status(429).json({ error: 'Too many requests from this network. Please try again later.' });
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 320);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!mailConfigured() || Date.now() < mailDownUntil) return answer(FALLBACK);
    const who = hashOf(email);
    if (!resetByEmail.allow(who)) { log('info', 'auth mail: reset rate-limited', { who }); return answer({ sent: true }); }
    let link;
    try {
      link = rewriteActionLink(await deps.auth().generatePasswordResetLink(email, { url: origin() + '/feed' }), origin());
    } catch (e) {
      const code = String(e?.code || e?.errorInfo?.code || e?.message || 'error');
      if (/user-not-found|email-not-found|invalid-email/i.test(code)) { log('info', 'auth mail: reset for no account', { who }); return answer({ sent: true }); }
      if (SETUP_ERROR.test(code)) { log('warn', 'auth mail: reset link failed, falling back', { code: code.slice(0, 80), reason: reasonOf(e) }); return answer(FALLBACK); }
      log('warn', 'auth mail: reset link error', { who, code: code.slice(0, 80) });
      return answer({ sent: true });
    }
    const r = await sendMail({ to: email, ...resetLetter({ link }), tags: [{ name: 'kind', value: 'reset' }] });
    if (!r.sent) {
      mailDownUntil = Date.now() + 10 * 60_000;
      log('warn', 'auth mail: reset send failed, falling back for 10 minutes', { who, error: r.error });
      return answer(FALLBACK);
    }
    log('info', 'auth mail: reset sent', { who, id: r.id });
    answer({ sent: true });
  });
}
