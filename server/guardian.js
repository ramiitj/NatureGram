/**
 * Teen mode with a parent's consent (India's DPDP Act 2023 treats under-18s as children).
 *
 * An explorer aged 13 to 17 signs up normally; their profile carries ageBand 'teen' and adultFrom
 * (the first day of the month they turn 18; no date of birth is stored). Until a parent or guardian
 * approves, their notebook is private: they can browse and keep a journal, nothing more. After
 * approval they can share sightings (never where), write letters to explorers they both follow,
 * and they are left out of ads, analytics and suggestions to strangers.
 *
 *   POST /api/guardian/request   (teen)    ask a parent; send, resend or change the parent's email
 *   GET  /api/guardian/request?t=           what the parent is being asked (no parent email exposed)
 *   POST /api/guardian/approve   (parent)  signed in with the verified email the request went to, adult, a different account
 *   POST /api/guardian/decline   (parent)
 *   POST /api/guardian/withdraw  (parent)  back to the private notebook
 *   POST /api/guardian/delete    (parent)  close the child's account (disabled now, removed by the admin)
 *
 * Records (Admin SDK only; the rules keep clients out):
 *   guardian_requests/{sha256(token)}  teenUid, parentEmail (deleted once settled), createdAt, expiresAt, status
 *   guardian_consents/{teenUid}        status, adultFrom, parentUid, method, policyVersion, approvedAt, ipHash, history
 *   deletion_requests/{teenUid}        a parent asked for the account to be closed
 * The raw token exists only in the link; the server keeps its hash.
 */
import crypto from 'crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { sendMail, letterHtml, letterText, mailConfigured, publicOrigin } from './mailer.js';

export const GUARDIAN_POLICY_VERSION = '2026-11-teen-1';
export const CONSENT_METHOD = 'adult-account+email-link';
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_DAY = 5;
const MIN_GAP_MS = 60_000;

// ------------------------------------------------------------------ pure helpers (tested)
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
/** A single-use token for the parent's link: 32 random bytes, URL-safe. */
export const newToken = () => crypto.randomBytes(32).toString('base64url');
/** What the server stores and looks up: the hash of the token, never the token. */
export const tokenHash = (token) => sha256(`ng-guardian:${String(token || '')}`);
export const validTokenShape = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(t);
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(e.trim());
/** Salted with the teen's uid, so the same address can't be matched across explorers. */
export const emailHash = (teenUid, email) => sha256(`${teenUid}:${normEmail(email)}`);
export const ipHash = (ip) => sha256(`ng-ip:${String(ip || '')}`).slice(0, 32);
export const maskEmail = (e) => {
  const [user, domain] = normEmail(e).split('@');
  if (!domain) return '';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
};

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : t instanceof Date ? t.getTime() : typeof t === 'number' ? t : t?._seconds ? t._seconds * 1000 : t?.seconds ? t.seconds * 1000 : 0);

/** 'teen' only while ageBand says so and adultFrom hasn't passed. No ageBand (older accounts) = adult. */
export function bandOf(profile, now = Date.now()) {
  if (!profile || profile.ageBand !== 'teen') return 'adult';
  const from = ms(profile.adultFrom);
  if (from && from <= now) return 'adult';
  return 'teen';
}
/** What the server should allow for this explorer right now. */
export function teenPolicy(profile, now = Date.now()) {
  const teen = bandOf(profile, now) === 'teen';
  const approved = teen && profile?.guardian?.status === 'approved';
  return { teen, approved, due: profile?.ageBand === 'teen' && !teen };
}
/** The state of a parent's link: 'open' | 'expired' | 'used' | 'replaced' | 'invalid'. */
export function requestState(req, now = Date.now()) {
  if (!req || !req.teenUid) return 'invalid';
  if (req.status === 'approved' || req.status === 'declined') return 'used';
  if (req.status === 'replaced') return 'replaced';
  if (req.status !== 'open') return 'invalid';
  if (ms(req.expiresAt) <= now) return 'expired';
  return 'open';
}
/**
 * Who may answer for a teen: a signed-in, email-verified adult account that isn't the teen's own,
 * whose verified email is the address the request was sent to (case-insensitive), and who says they
 * are 18 or older and the parent or guardian. Returns null, or { status, code, message }.
 */
export function parentProblem({ parent, parentProfile, teenUid, confirmAdult, confirmGuardian, requestEmailHash, now = Date.now() }, { forDecline = false } = {}) {
  if (!parent || parent.isAnonymous) return { status: 401, code: 'signin', message: 'Please sign in to your own account first.' };
  if (parent.uid === teenUid) return { status: 403, code: 'same', message: 'This needs a grown-up\'s own account, not the explorer\'s. Please sign in as yourself.' };
  if (bandOf(parentProfile, now) === 'teen') return { status: 403, code: 'teen', message: 'This account belongs to a teenage explorer, so it can\'t give consent. Please sign in with a parent or guardian\'s account.' };
  if (forDecline) return null;
  if (!parent.emailVerified) return { status: 403, code: 'verify', message: 'Please verify your email address first. We\'ve sent a link to your inbox.' };
  // Consent comes from the address the explorer named: the approving account's verified email must be it
  if (requestEmailHash && !(parent.email && emailHash(teenUid, parent.email) === requestEmailHash)) {
    return { status: 403, code: 'email-mismatch', message: 'Please sign in with the email address the request was sent to.' };
  }
  if (confirmAdult !== true || confirmGuardian !== true) return { status: 400, code: 'confirm', message: 'Please confirm that you are 18 or older and their parent or guardian.' };
  return null;
}

/** The same facts go into the letter and onto the consent page. */
export const GUARDIAN_FACTS = Object.freeze({
  // glossary-ok: record as a verb
  what: 'NatureGram is a field notebook for the living world. Explorers photograph and record plants, animals, fungi and natural sounds, keep a life list of the species they find, and can ask an AI guide to help identify them.',
  collected: [
    'Their email address and the username they chose',
    'Their sightings: photos, sound clips, species names and their own notes',
    'Where a sighting was made, kept private in their own journal and never shown to others',
    'Who they follow and who follows them, and letters with explorers they both follow',
    'What they show or say to the AI guide during a session, used only to answer them',
  ],
  notCollected: [
    'Their date of birth (we keep only the month they turn 18)',
    'Phone number, contacts or address',
    // glossary-ok: an advertising profile, not a field page
    'Any advertising profile, tracking or behavioural monitoring',
  ],
  teenMode: [
    'No ads and no advertising measurement',
    'No usage analytics tied to them',
    'Where a sighting was made is always hidden from others',
    'Letters only with explorers they both follow',
    'Not suggested in search or explorer lists to people who don\'t follow them',
    'The AI guide never asks for personal details',
  ],
  controls: [
    'Withdraw your consent at any time: their field page goes back to private',
    'Ask us to delete their account and everything in it',
    'Write to us with any question about their data',
  ],
});

// ------------------------------------------------------------------ colour for the letter
const hexToRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
/** Darken the naturalist's accent until white button text reads clearly on it (4.5:1). */
export function letterAccent(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#8a3b12';
  let rgb = hexToRgb(hex);
  for (let i = 0; i < 30 && 1.05 / (lum(rgb) + 0.05) < 4.5; i++) rgb = rgb.map(c => Math.round(c * 0.9));
  return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

function parentLetter({ teenName, link, accent, naturalist }) {
  const li = (xs) => xs.map(x => `• ${x}`).join('<br>');
  const m = {
    preheader: `${teenName} would like to explore NatureGram. It needs your OK.`,
    heading: `${teenName} would like to explore NatureGram`,
    paragraphs: [
      `Hello. ${teenName} has started a field page on NatureGram and named you as their parent or guardian. Because they are under 18, their field page stays private until you say it's all right.`,
      GUARDIAN_FACTS.what,
      `<strong>What we keep about them</strong><br>${li(GUARDIAN_FACTS.collected)}`,
      `<strong>What we never keep</strong><br>${li(GUARDIAN_FACTS.notCollected)}`,
      `<strong>What teen mode switches off</strong><br>${li(GUARDIAN_FACTS.teenMode)}`,
      'To approve, you\'ll sign in to (or create) your own NatureGram account and confirm you\'re their parent or guardian. It takes about two minutes.',
    ],
    button: { label: 'Review and approve', url: link },
    after: [
      'This link works once and for 7 days. If you weren\'t expecting this, you can ignore it: nothing changes and their field page stays private.',
      `<strong>Your controls, any time</strong><br>${li(GUARDIAN_FACTS.controls)}`,
    ],
    accent,
    footnote: naturalist ? `Sent in the fortnight of ${naturalist}.` : undefined,
  };
  return { html: letterHtml(m), text: letterText(m) };
}

// ------------------------------------------------------------------ graduation (lazy)
/**
 * On or after adultFrom a teen becomes an adult: ageBand 'adult', guardian links removed.
 * Called wherever the server reads a band; functions/index.js does the same nightly.
 */
export async function graduateIfDue(db, uid, profile, now = Date.now()) {
  if (!db || !profile || !teenPolicy(profile, now).due) return profile;
  const parentUid = profile.guardian?.parentUid || null;
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), { ageBand: 'adult', adultFrom: FieldValue.delete(), guardian: FieldValue.delete(), graduatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (parentUid) batch.set(db.doc(`users/${parentUid}`), { guardianOf: FieldValue.arrayRemove(uid) }, { merge: true });
  batch.set(db.doc(`guardian_consents/${uid}`), { status: 'graduated', graduatedAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion({ event: 'graduated', at: Timestamp.fromMillis(now) }) }, { merge: true });
  await batch.commit().catch(() => {});
  const { adultFrom, guardian, ...rest } = profile;
  return { ...rest, ageBand: 'adult' };
}

/** The explorer's profile, graduated first if their 18th has come. */
export async function profileWithBand(db, uid) {
  const snap = await db.doc(`users/${uid}`).get().catch(() => null);
  const profile = snap?.exists ? snap.data() : null;
  return profile ? graduateIfDue(db, uid, profile) : null;
}

// ------------------------------------------------------------------ routes
export function mountGuardian(app, deps) {
  const { verifyIdToken, bearer, clientIp, log } = deps;
  const limiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
  const sendLimiter = rateLimit({ windowMs: 60 * 60_000, max: 8, standardHeaders: true, legacyHeaders: false });
  const json = express.json({ limit: '4kb' });
  const say = (res, status, code, message, extra = {}) => res.status(status).json({ ok: false, code, message, ...extra });
  const userOf = async (req) => { try { return await verifyIdToken(String(bearer(req))); } catch { return null; } };

  // The teen asks (or asks again, or asks someone else)
  app.post('/api/guardian/request', sendLimiter, json, async (req, res) => {
    const db = deps.db();
    if (!db) return say(res, 503, 'unavailable', 'This is unavailable for a moment. Please try again.');
    const user = await userOf(req);
    if (!user || user.isAnonymous) return say(res, 401, 'auth', 'Please sign in again.');
    const profile = await profileWithBand(db, user.uid);
    const policy = teenPolicy(profile);
    if (!policy.teen) return say(res, 400, 'not-teen', 'Your account doesn\'t need a grown-up\'s OK.');
    if (policy.approved) return say(res, 409, 'approved', 'Your grown-up has already said yes.');

    const consentRef = db.doc(`guardian_consents/${user.uid}`);
    const consent = (await consentRef.get().catch(() => null))?.data() || {};
    let previous = null;
    if (consent.openRequest) previous = (await db.doc(`guardian_requests/${consent.openRequest}`).get().catch(() => null))?.data() || null;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = typeof body.parentEmail === 'string' && body.parentEmail.trim() ? body.parentEmail.trim().slice(0, 254)
      : (previous?.parentEmail || '');
    if (!validEmail(email)) return say(res, 400, 'email', 'That email address doesn\'t look quite right. Could you check it?');
    if (user.email && normEmail(user.email) === normEmail(email)) return say(res, 400, 'own-email', 'That\'s your own email. Please ask a parent or guardian for theirs.');

    const now = Date.now();
    const recent = (Array.isArray(consent.sends) ? consent.sends : []).map(ms).filter(t => now - t < 86_400_000);
    if (recent.length >= MAX_REQUESTS_PER_DAY) return say(res, 429, 'limit', 'That\'s a few letters today already. Try again tomorrow, or share the link instead.');
    if (recent.length && now - Math.max(...recent) < MIN_GAP_MS) return say(res, 429, 'wait', 'Give it a minute before sending again.');

    const token = newToken();
    const hash = tokenHash(token);
    const expiresAt = Timestamp.fromMillis(now + TOKEN_TTL_MS);
    const link = `${publicOrigin()}/guardian?t=${token}`;
    const eh = emailHash(user.uid, email);
    const batch = db.batch();
    batch.set(db.doc(`guardian_requests/${hash}`), { teenUid: user.uid, parentEmail: normEmail(email), emailHash: eh, createdAt: FieldValue.serverTimestamp(), expiresAt, status: 'open' });
    // A new link replaces the old one, whose email address is dropped
    if (consent.openRequest && consent.openRequest !== hash && previous && ['open', 'expired'].includes(requestState(previous))) {
      batch.set(db.doc(`guardian_requests/${consent.openRequest}`), { status: 'replaced', parentEmail: FieldValue.delete(), settledAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    batch.set(consentRef, {
      teenUid: user.uid, status: 'pending', openRequest: hash, adultFrom: profile.adultFrom || null,
      sends: [...recent.slice(-9), now], updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion({ event: previous && previous.emailHash === eh ? 'resent' : 'requested', at: Timestamp.fromMillis(now) }),
    }, { merge: true });
    batch.set(db.doc(`users/${user.uid}`), { guardian: { status: 'pending', emailHash: eh, requestedAt: FieldValue.serverTimestamp() } }, { merge: true });
    try { await batch.commit(); } catch (e) {
      log('error', 'guardian request write failed', { uid: user.uid, error: String(e.message).slice(0, 120) });
      return say(res, 503, 'unavailable', 'This is unavailable for a moment. Please try again.');
    }

    const teenName = String(profile.username || 'An explorer').slice(0, 40);
    let sent = { sent: false };
    if (mailConfigured()) {
      const theme = typeof deps.theme === 'function' ? deps.theme() : null;
      const letter = parentLetter({ teenName, link, accent: letterAccent(theme?.accent), naturalist: theme?.naturalist });
      sent = await sendMail({ to: email, subject: `${teenName} would like to explore NatureGram`, html: letter.html, text: letter.text, tags: [{ name: 'kind', value: 'guardian' }] });
      if (!sent.sent) log('warn', 'guardian letter not sent', { uid: user.uid, error: sent.error });
    }
    log('info', 'guardian requested', { uid: user.uid, sent: sent.sent });
    // With no mail provider (or a failed send) the teen passes the link on themselves
    res.json({ ok: true, sent: sent.sent, to: maskEmail(email), expiresAt: expiresAt.toMillis(), ...(sent.sent ? {} : { link }) });
  });

  // What the parent is being asked
  app.get('/api/guardian/request', limiter, async (req, res) => {
    const db = deps.db();
    if (!db) return say(res, 503, 'unavailable', 'This is unavailable for a moment. Please try again.');
    res.setHeader('Cache-Control', 'no-store');
    const t = String(req.query.t || '');
    if (!validTokenShape(t)) return say(res, 404, 'invalid', 'This link isn\'t one we recognise.');
    const snap = await db.doc(`guardian_requests/${tokenHash(t)}`).get().catch(() => null);
    const r = snap?.exists ? snap.data() : null;
    const state = requestState(r);
    if (state === 'invalid') return say(res, 404, 'invalid', 'This link isn\'t one we recognise.');
    const teen = (await db.doc(`users/${r.teenUid}`).get().catch(() => null))?.data() || {};
    const first = String(teen.displayName || '').trim().split(/\s+/)[0] || '';
    const summary = {
      username: String(teen.username || 'An explorer').slice(0, 40),
      firstName: first && first.toLowerCase() !== String(teen.username || '').toLowerCase() ? first.slice(0, 30) : null,
      avatarUrl: teen.avatarUrl || null,
    };
    if (state !== 'open') return say(res, 410, state, state === 'expired' ? 'This link has expired.' : state === 'replaced' ? 'A newer link was sent.' : 'This link has already been used.', { teen: summary, outcome: r.status });
    res.json({ ok: true, state, teen: summary, expiresAt: ms(r.expiresAt), facts: GUARDIAN_FACTS, policyVersion: GUARDIAN_POLICY_VERSION });
  });

  /** Common checks for approve and decline; resolves the request or sends the refusal. */
  const settle = async (req, res, forDecline) => {
    const db = deps.db();
    if (!db) { say(res, 503, 'unavailable', 'This is unavailable for a moment. Please try again.'); return null; }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const t = String(body.t || '');
    if (!validTokenShape(t)) { say(res, 404, 'invalid', 'This link isn\'t one we recognise.'); return null; }
    const parent = await userOf(req);
    if (!parent) { say(res, 401, 'signin', 'Please sign in to your own account first.'); return null; }
    const ref = db.doc(`guardian_requests/${tokenHash(t)}`);
    const r = (await ref.get().catch(() => null))?.data() || null;
    const state = requestState(r);
    if (state !== 'open') { say(res, state === 'invalid' ? 404 : 410, state, state === 'expired' ? 'This link has expired.' : state === 'invalid' ? 'This link isn\'t one we recognise.' : 'This link has already been used.'); return null; }
    const parentProfile = await profileWithBand(db, parent.uid);
    const problem = parentProblem({ parent, parentProfile, teenUid: r.teenUid, confirmAdult: body.confirmAdult, confirmGuardian: body.confirmGuardian, requestEmailHash: r.emailHash || null }, { forDecline });
    if (problem) { say(res, problem.status, problem.code, problem.message); return null; }
    const teenProfile = await profileWithBand(db, r.teenUid);
    if (!teenProfile || !teenPolicy(teenProfile).teen) { say(res, 410, 'not-teen', 'This explorer no longer needs a grown-up\'s OK.'); return null; }
    return { db, ref, r, parent, teenProfile, hash: tokenHash(t) };
  };

  app.post('/api/guardian/approve', limiter, json, async (req, res) => {
    const ctx = await settle(req, res, false);
    if (!ctx) return;
    const { db, ref, r, parent, teenProfile, hash } = ctx;
    const teenUid = r.teenUid;
    const emailMatched = Boolean(parent.email && emailHash(teenUid, parent.email) === r.emailHash);
    try {
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(ref)).data();
        if (requestState(fresh) !== 'open') throw Object.assign(new Error('used'), { code: 'used' });
        tx.set(ref, { status: 'approved', parentEmail: FieldValue.delete(), settledAt: FieldValue.serverTimestamp(), settledBy: parent.uid }, { merge: true });
        tx.set(db.doc(`guardian_consents/${teenUid}`), {
          teenUid, status: 'approved', parentUid: parent.uid, method: CONSENT_METHOD, policyVersion: GUARDIAN_POLICY_VERSION,
          approvedAt: FieldValue.serverTimestamp(), ipHash: ipHash(clientIp(req)), parentEmailVerified: true, emailMatched,
          confirmations: { adult: true, guardian: true }, request: hash, openRequest: FieldValue.delete(), adultFrom: teenProfile.adultFrom || null,
          history: FieldValue.arrayUnion({ event: 'approved', by: parent.uid, at: Timestamp.now() }),
        }, { merge: true });
        tx.set(db.doc(`users/${teenUid}`), { guardian: { status: 'approved', parentUid: parent.uid, approvedAt: FieldValue.serverTimestamp() } }, { merge: true });
        tx.set(db.doc(`users/${parent.uid}`), { guardianOf: FieldValue.arrayUnion(teenUid) }, { merge: true });
      });
    } catch (e) {
      if (e.code === 'used') return say(res, 410, 'used', 'This link has already been used.');
      log('error', 'guardian approve failed', { error: String(e.message).slice(0, 120) });
      return say(res, 503, 'unavailable', 'This is unavailable for a moment. Please try again.');
    }
    await db.collection(`users/${teenUid}/notifications`).add({
      type: 'system', senderId: 'naturegram', senderName: 'NatureGram', isRead: false, timestamp: FieldValue.serverTimestamp(),
      message: 'Your grown-up said yes. Your field page is open: you can share sightings with the community now.',
    }).catch(() => {});
    log('info', 'guardian approved', { teenUid, parentUid: parent.uid, emailMatched });
    res.json({ ok: true, teen: { uid: teenUid, username: teenProfile.username || 'An explorer' } });
  });

  app.post('/api/guardian/decline', limiter, json, async (req, res) => {
    const ctx = await settle(req, res, true);
    if (!ctx) return;
    const { db, ref, r, parent, hash } = ctx;
    const batch = db.batch();
    batch.set(ref, { status: 'declined', parentEmail: FieldValue.delete(), settledAt: FieldValue.serverTimestamp(), settledBy: parent.uid }, { merge: true });
    batch.set(db.doc(`guardian_consents/${r.teenUid}`), { status: 'declined', declinedAt: FieldValue.serverTimestamp(), request: hash, openRequest: FieldValue.delete(), history: FieldValue.arrayUnion({ event: 'declined', by: parent.uid, at: Timestamp.now() }) }, { merge: true });
    batch.set(db.doc(`users/${r.teenUid}`), { guardian: { status: 'declined', declinedAt: FieldValue.serverTimestamp() } }, { merge: true });
    await batch.commit();
    log('info', 'guardian declined', { teenUid: r.teenUid });
    res.json({ ok: true });
  });

  /** The parent of record for a teen, or a refusal. */
  const asParent = async (req, res) => {
    const db = deps.db();
    if (!db) { say(res, 503, 'unavailable', 'This is unavailable for a moment. Please try again.'); return null; }
    const parent = await userOf(req);
    if (!parent || parent.isAnonymous) { say(res, 401, 'signin', 'Please sign in again.'); return null; }
    const teenUid = String(req.body?.teenUid || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(teenUid)) { say(res, 400, 'bad', 'Bad request'); return null; }
    const consent = (await db.doc(`guardian_consents/${teenUid}`).get().catch(() => null))?.data();
    if (!consent || consent.parentUid !== parent.uid) { say(res, 403, 'not-parent', 'Only the parent or guardian who gave consent can change this.'); return null; }
    return { db, parent, teenUid, consent };
  };

  /** Take a teen's sightings out of the feed (back to their private notebook). */
  const makePrivate = async (db, teenUid) => {
    const snap = await db.collection('ecosystem_feed').where('userId', '==', teenUid).where('isPublic', '==', true).limit(400).get().catch(() => null);
    if (!snap || snap.empty) return 0;
    const batch = db.batch();
    snap.docs.forEach(d => { batch.update(d.ref, { isPublic: false }); batch.delete(db.doc(`feed_thumbnails/${d.id}`)); });
    await batch.commit().catch(() => {});
    return snap.size;
  };

  app.post('/api/guardian/withdraw', limiter, json, async (req, res) => {
    const ctx = await asParent(req, res);
    if (!ctx) return;
    const { db, parent, teenUid, consent } = ctx;
    if (consent.status !== 'approved') return say(res, 409, 'not-approved', 'Consent isn\'t active for this explorer.');
    const batch = db.batch();
    batch.set(db.doc(`guardian_consents/${teenUid}`), { status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion({ event: 'withdrawn', by: parent.uid, at: Timestamp.now() }) }, { merge: true });
    batch.set(db.doc(`users/${teenUid}`), { guardian: { status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp() } }, { merge: true });
    await batch.commit();
    const hidden = await makePrivate(db, teenUid);
    await db.collection(`users/${teenUid}/notifications`).add({
      type: 'system', senderId: 'naturegram', senderName: 'NatureGram', isRead: false, timestamp: FieldValue.serverTimestamp(),
      message: 'Your grown-up has paused sharing. Your field page is private again, and everything in it is still yours.',
    }).catch(() => {});
    log('info', 'guardian withdrew', { teenUid, hidden });
    res.json({ ok: true, status: 'withdrawn' });
  });

  // There is no server-side account removal yet, so the account is switched off now (sign-in
  // disabled, sessions ended, sightings private) and flagged for the admin to finish removing.
  app.post('/api/guardian/delete', limiter, json, async (req, res) => {
    const ctx = await asParent(req, res);
    if (!ctx) return;
    const { db, parent, teenUid } = ctx;
    if (req.body?.confirm !== true) return say(res, 400, 'confirm', 'Please confirm you want their account deleted.');
    const batch = db.batch();
    batch.set(db.doc(`deletion_requests/${teenUid}`), { uid: teenUid, requestedBy: parent.uid, reason: 'guardian', status: 'open', createdAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(db.doc(`guardian_consents/${teenUid}`), { status: 'deletion-requested', deletionRequestedAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion({ event: 'deletion-requested', by: parent.uid, at: Timestamp.now() }) }, { merge: true });
    batch.set(db.doc(`users/${teenUid}`), { guardian: { status: 'withdrawn', deletionRequestedAt: FieldValue.serverTimestamp() } }, { merge: true });
    await batch.commit();
    await makePrivate(db, teenUid);
    const auth = typeof deps.auth === 'function' ? deps.auth() : null;
    if (auth) {
      await auth.updateUser(teenUid, { disabled: true }).catch(() => {});
      await auth.revokeRefreshTokens(teenUid).catch(() => {});
    }
    log('info', 'guardian asked for deletion', { teenUid });
    res.json({ ok: true, status: 'deletion-requested' });
  });
}
