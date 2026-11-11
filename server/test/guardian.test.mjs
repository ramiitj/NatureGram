// Run: node --test server/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { newToken, tokenHash, validTokenShape, emailHash, maskEmail, validEmail, bandOf, teenPolicy, requestState, parentProblem, letterAccent, TOKEN_TTL_MS, GUARDIAN_FACTS } from '../guardian.js';
import { policyText, PERSONAL_DETAILS_RULE } from '../aiGovernance.js';
import { DEFAULT_SETTINGS } from '../settings.js';

const ts = (ms) => ({ toMillis: () => ms });
const NOW = Date.UTC(2026, 10, 10);

test('guardian tokens: random, URL-safe, stored only as a hash', () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a, b);
  assert.ok(validTokenShape(a) && /^[A-Za-z0-9_-]+$/.test(a));
  const h = tokenHash(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, tokenHash(a));
  assert.notEqual(h, tokenHash(b));
  assert.ok(!h.includes(a));
  assert.ok(!validTokenShape('short') && !validTokenShape('../../etc/passwd/../../etc/passwd/../../etc/x'));
});

test('parent email: salted per explorer, masked when shown, checked', () => {
  assert.equal(emailHash('teen1', ' Mum@Example.com '), emailHash('teen1', 'mum@example.com'));
  assert.notEqual(emailHash('teen1', 'mum@example.com'), emailHash('teen2', 'mum@example.com'));
  assert.equal(maskEmail('mum@example.com'), 'm••@example.com');
  assert.ok(validEmail('parent@example.co.in'));
  assert.ok(!validEmail('not an email') && !validEmail('a@b') && !validEmail(''));
});

test('age band: teen until adultFrom, older accounts are adults', () => {
  assert.equal(bandOf(null), 'adult');
  assert.equal(bandOf({ username: 'legacy' }), 'adult');
  assert.equal(bandOf({ ageBand: 'adult' }), 'adult');
  assert.equal(bandOf({ ageBand: 'teen', adultFrom: ts(NOW + 86_400_000) }, NOW), 'teen');
  assert.equal(bandOf({ ageBand: 'teen', adultFrom: ts(NOW - 1) }, NOW), 'adult');
  assert.deepEqual(teenPolicy({ ageBand: 'teen', adultFrom: ts(NOW + 1e9), guardian: { status: 'pending' } }, NOW), { teen: true, approved: false, due: false });
  assert.deepEqual(teenPolicy({ ageBand: 'teen', adultFrom: ts(NOW + 1e9), guardian: { status: 'approved' } }, NOW), { teen: true, approved: true, due: false });
  assert.deepEqual(teenPolicy({ ageBand: 'teen', adultFrom: ts(NOW - 1), guardian: { status: 'approved' } }, NOW), { teen: false, approved: false, due: true });
});

test('links expire after 7 days and work once', () => {
  const open = { teenUid: 't', status: 'open', expiresAt: ts(NOW + TOKEN_TTL_MS) };
  assert.equal(TOKEN_TTL_MS, 7 * 86_400_000);
  assert.equal(requestState(open, NOW), 'open');
  assert.equal(requestState(open, NOW + TOKEN_TTL_MS), 'expired');
  assert.equal(requestState({ ...open, status: 'approved' }, NOW), 'used');
  assert.equal(requestState({ ...open, status: 'declined' }, NOW), 'used');
  assert.equal(requestState({ ...open, status: 'replaced' }, NOW), 'replaced');
  assert.equal(requestState(null, NOW), 'invalid');
});

test('only a different, verified, adult account can approve', () => {
  const parent = { uid: 'p', emailVerified: true, isAnonymous: false };
  const ok = { parent, parentProfile: { ageBand: 'adult' }, teenUid: 't', confirmAdult: true, confirmGuardian: true, now: NOW };
  assert.equal(parentProblem(ok), null);
  assert.equal(parentProblem({ ...ok, parentProfile: { username: 'legacy' } }), null);
  assert.equal(parentProblem({ ...ok, parent: { ...parent, uid: 't' } }).code, 'same');
  assert.equal(parentProblem({ ...ok, parent: { ...parent, emailVerified: false } }).code, 'verify');
  assert.equal(parentProblem({ ...ok, parentProfile: { ageBand: 'teen', adultFrom: ts(NOW + 1e9) } }).code, 'teen');
  assert.equal(parentProblem({ ...ok, confirmGuardian: false }).code, 'confirm');
  assert.equal(parentProblem({ ...ok, confirmAdult: 'yes' }).code, 'confirm');
  assert.equal(parentProblem({ ...ok, parent: null }).code, 'signin');
  assert.equal(parentProblem({ ...ok, parent: { ...parent, uid: 't' } }, { forDecline: true }).code, 'same');
});

test('approval needs the verified email the request was sent to (any letter case)', () => {
  const hash = emailHash('t', 'Parent@Example.com');
  const base = { parentProfile: { ageBand: 'adult' }, teenUid: 't', confirmAdult: true, confirmGuardian: true, requestEmailHash: hash, now: NOW };
  const as = (email, extra = {}) => ({ ...base, parent: { uid: 'p', emailVerified: true, isAnonymous: false, email, ...extra } });
  assert.equal(parentProblem(as('parent@example.com')), null);
  assert.equal(parentProblem(as('  PARENT@example.COM ')), null);
  const other = parentProblem(as('someone.else@example.com'));
  assert.equal(other.code, 'email-mismatch');
  assert.equal(other.message, 'Please sign in with the email address the request was sent to.');
  assert.equal(parentProblem(as(null)).code, 'email-mismatch');
  // Verification is asked for first, and declining doesn't need the matching address
  assert.equal(parentProblem(as('parent@example.com', { emailVerified: false })).code, 'verify');
  assert.equal(parentProblem(as('someone.else@example.com'), { forDecline: true }), null);
});

test('letter colour stays readable; facts cover what teen mode switches off', () => {
  const hex = letterAccent('#aed581');
  assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.notEqual(hex, '#aed581');
  assert.equal(letterAccent('nope'), '#8a3b12');
  assert.ok(GUARDIAN_FACTS.teenMode.some(x => /ads/i.test(x)) && GUARDIAN_FACTS.notCollected.some(x => /birth/i.test(x)));
});

test('the guide never asks for personal details, whatever the admin policy says', () => {
  assert.ok(policyText(DEFAULT_SETTINGS).includes(PERSONAL_DETAILS_RULE));
  assert.ok(policyText({ ...DEFAULT_SETTINGS, policy: '' }).includes('Never ask the explorer for personal details'));
});
