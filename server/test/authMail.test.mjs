// Run: node --test server/test/authMail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import express from 'express';
import { rewriteActionLink, mountAuthMail, makeLimiter, inkFor, LETTER_NATURALISTS, verificationLetter } from '../authMail.js';

const FB = 'https://biostream-6490a.firebaseapp.com/__/auth/action';

test('action links are rebuilt on our origin with only what the page needs', () => {
  const src = `${FB}?mode=verifyEmail&oobCode=ABC-123_x&apiKey=AIzaSecret&continueUrl=${encodeURIComponent('https://thenaturegram.com/welcome')}&lang=en`;
  const out = new URL(rewriteActionLink(src, 'https://thenaturegram.com'));
  assert.equal(out.origin, 'https://thenaturegram.com');
  assert.equal(out.pathname, '/auth/action');
  assert.equal(out.searchParams.get('mode'), 'verifyEmail');
  assert.equal(out.searchParams.get('oobCode'), 'ABC-123_x');
  assert.equal(out.searchParams.get('continueUrl'), 'https://thenaturegram.com/welcome');
  assert.equal(out.searchParams.get('apiKey'), null);
  assert.equal(out.searchParams.get('lang'), null);
  const reset = new URL(rewriteActionLink(`${FB}?mode=resetPassword&oobCode=Z&apiKey=k`, 'https://thenaturegram.com/'));
  assert.equal(reset.toString(), 'https://thenaturegram.com/auth/action?mode=resetPassword&oobCode=Z');
  assert.throws(() => rewriteActionLink(`${FB}?mode=verifyEmail`));
});

test('the letter naturalists mirror constants/naturalists.ts', () => {
  const ts = fs.readFileSync(new URL('../../constants/naturalists.ts', import.meta.url), 'utf8');
  const re = /naturalist: '([^']+)',\s*quote: "([^"]+)"[\s\S]*?accent: "(#[0-9a-f]+)"/g;
  const found = [...ts.matchAll(re)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(found, LETTER_NATURALISTS);
});

test('button ink is deep enough for white text', () => {
  for (const [, , accent] of LETTER_NATURALISTS) {
    const hex = inkFor(accent);
    const lum = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    assert.ok(1.05 / (L + 0.05) >= 4.5, `${accent} -> ${hex}`);
  }
});

test('verification letter greets by name, escapes it, and carries the link', () => {
  const l = verificationLetter({ username: '<b>ana</b>', link: 'https://thenaturegram.com/auth/action?mode=verifyEmail&oobCode=1' });
  assert.match(l.html, /Hi &lt;b&gt;ana&lt;\/b&gt;,/);
  assert.match(l.html, /Confirm my email/);
  assert.match(l.html, /oobCode=1/);
  assert.match(l.html, /ignore this letter/);
});

test('limiter: three an hour per key', () => {
  const l = makeLimiter(3, 3_600_000);
  assert.ok(l.allow('a', 0) && l.allow('a', 1) && l.allow('a', 2));
  assert.ok(!l.allow('a', 3));
  assert.ok(l.allow('b', 3));
  assert.ok(l.allow('a', 3_600_001));
});

const serve = async (deps) => {
  const app = express();
  app.set('trust proxy', true);
  const logs = [];
  mountAuthMail(app, {
    verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1', email: 'ana@example.com', emailVerified: false, isAnonymous: false }; },
    bearer: (req) => (req.headers.authorization || '').replace(/^Bearer /, ''),
    clientIp: (req) => req.headers['x-test-ip'] || 'ip',
    log: (level, msg, meta) => logs.push(JSON.stringify({ level, msg, meta })),
    minResetMs: 0,
    origin: 'https://thenaturegram.com',
    ...deps,
  });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, headers = {}) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json() };
  };
  return { post, logs, close: () => server.close() };
};

const fakeAuth = (known) => ({
  generatePasswordResetLink: async (email) => {
    if (!known.includes(email)) { const e = new Error('no user'); e.code = 'auth/email-not-found'; throw e; }
    return `${FB}?mode=resetPassword&oobCode=SECRETCODE&apiKey=k`;
  },
  generateEmailVerificationLink: async () => `${FB}?mode=verifyEmail&oobCode=SECRETCODE&apiKey=k&continueUrl=x`,
  getUser: async () => ({ displayName: 'ana', emailVerified: false }),
});

test('send-reset answers the same for known and unknown addresses, and never logs links', async () => {
  const sent = [];
  const s = await serve({ auth: () => fakeAuth(['known@example.com']), mailConfigured: () => true, sendMail: async (m) => { sent.push(m); return { sent: true, id: 'm1' }; } });
  try {
    const a = await s.post('/api/auth/send-reset', { email: 'known@example.com' }, { 'x-test-ip': '1' });
    const b = await s.post('/api/auth/send-reset', { email: 'nobody@example.com' }, { 'x-test-ip': '2' });
    assert.deepEqual(a, b);
    assert.deepEqual(a, { status: 200, body: { sent: true } });
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /https:\/\/thenaturegram\.com\/auth\/action\?mode=resetPassword&amp;oobCode=SECRETCODE/);
    // Past the per-address limit the answer is still the same, and nothing more is sent
    for (let i = 0; i < 4; i++) assert.deepEqual(await s.post('/api/auth/send-reset', { email: 'known@example.com' }, { 'x-test-ip': `x${i}` }), a);
    assert.equal(sent.length, 3);
    assert.ok(!s.logs.some(l => /SECRETCODE|example\.com|oobCode/.test(l)), 'no links or addresses in logs');
  } finally { s.close(); }
});

test('send-reset falls back for everyone when mail is not configured or links cannot be made', async () => {
  const s1 = await serve({ auth: () => fakeAuth(['known@example.com']), mailConfigured: () => false });
  try {
    const a = await s1.post('/api/auth/send-reset', { email: 'known@example.com' });
    const b = await s1.post('/api/auth/send-reset', { email: 'nobody@example.com' });
    assert.deepEqual(a.body, { sent: false, fallback: true });
    assert.deepEqual(a, b);
  } finally { s1.close(); }
  const denied = { generatePasswordResetLink: async () => { const e = new Error('x'); e.code = 'auth/insufficient-permission'; throw e; } };
  const s2 = await serve({ auth: () => denied, mailConfigured: () => true, sendMail: async () => ({ sent: true }) });
  try {
    assert.deepEqual((await s2.post('/api/auth/send-reset', { email: 'known@example.com' })).body, { sent: false, fallback: true });
  } finally { s2.close(); }
});

test('send-verification: needs a token, sends our letter, rate-limits per explorer', async () => {
  const sent = [];
  const s = await serve({ auth: () => fakeAuth([]), mailConfigured: () => true, sendMail: async (m) => { sent.push(m); return { sent: true }; } });
  try {
    assert.equal((await s.post('/api/auth/send-verification', {})).status, 401);
    const ok = await s.post('/api/auth/send-verification', {}, { Authorization: 'Bearer good' });
    assert.deepEqual(ok.body, { sent: true });
    assert.match(sent[0].subject, /field notebook/);
    assert.match(sent[0].html, /Hi ana,/);
    assert.match(sent[0].html, /thenaturegram\.com\/auth\/action\?mode=verifyEmail/);
    await s.post('/api/auth/send-verification', {}, { Authorization: 'Bearer good' });
    await s.post('/api/auth/send-verification', {}, { Authorization: 'Bearer good' });
    assert.equal((await s.post('/api/auth/send-verification', {}, { Authorization: 'Bearer good' })).status, 429);
    assert.ok(!s.logs.some(l => /SECRETCODE|oobCode|good/.test(l)));
  } finally { s.close(); }
});

test('send-reset with enumeration protection: unknown addresses answer like known ones', async () => {
  // Firebase with email enumeration protection: no link for unknown addresses, only a bare internal-error
  const known = ['known@example.com'];
  const auth = {
    getUserByEmail: async (email) => { if (!known.includes(email)) { const e = new Error('no user'); e.code = 'auth/user-not-found'; throw e; } return { uid: 'u1' }; },
    generatePasswordResetLink: async (email) => {
      if (!known.includes(email)) { const e = new Error('An internal error has occurred.'); e.code = 'auth/internal-error'; throw e; }
      return `${FB}?mode=resetPassword&oobCode=SECRETCODE&apiKey=k`;
    },
  };
  const sent = [];
  const s = await serve({ auth: () => auth, mailConfigured: () => true, sendMail: async (m) => { sent.push(m); return { sent: true }; } });
  try {
    const a = await s.post('/api/auth/send-reset', { email: 'known@example.com' }, { 'x-test-ip': 'e1' });
    const b = await s.post('/api/auth/send-reset', { email: 'nobody@example.com' }, { 'x-test-ip': 'e2' });
    assert.deepEqual(a, { status: 200, body: { sent: true } });
    assert.deepEqual(a, b);
    assert.equal(sent.length, 1);
  } finally { s.close(); }
});
