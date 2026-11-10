import React, { useEffect, useState } from 'react';
import { reload } from 'firebase/auth';
import Glyph from './Glyph';
import AuthModal from './AuthModal';
import { auth } from '../firebaseConfig';
import { FirebaseService } from '../services/firebaseService';
import { ThemeService } from '../services/themeService';
import { getDailyTheme as getFallbackTheme } from '../constants/naturalists';
import { guardianSummary, approveGuardian, declineGuardian, GuardianSummary } from '../services/guardian';

type Phase = 'loading' | 'open' | 'approved' | 'declined' | 'expired' | 'used' | 'replaced' | 'invalid' | 'offline';

const Mark: React.FC = () => (
  <a href="/" className="inline-flex items-center gap-2.5" aria-label="NatureGram home">
    <Glyph name="mark" size={22} className="text-stone-900" />
    <span className="font-display italic text-xl text-stone-900 tracking-tight">NatureGram</span>
  </a>
);

const List: React.FC<{ items: string[]; glyph: 'leaf' | 'feather' | 'stamp' | 'compass'; muted?: boolean }> = ({ items, glyph, muted }) => (
  <ul className="flex flex-col gap-2.5" role="list">
    {items.map(x => (
      <li key={x} className={`flex gap-2.5 text-[15px] leading-snug ${muted ? 'text-stone-600' : 'text-stone-800'}`}>
        <Glyph name={glyph} size={18} className="text-theme-accent mt-0.5 shrink-0" />{x}
      </li>
    ))}
  </ul>
);

/**
 * Where a parent lands from the letter (/guardian?t=…). A calm page that says what NatureGram is,
 * what we keep and don't, and what teen mode does; then asks them to sign in as themselves,
 * confirm they're an adult and the parent or guardian, and decide.
 */
const GuardianConsent: React.FC<{ token?: string }> = ({ token: given }) => {
  const token = given ?? (new URLSearchParams(window.location.search).get('t') || '');
  const [phase, setPhase] = useState<Phase>('loading');
  const [summary, setSummary] = useState<GuardianSummary | null>(null);
  const [teenName, setTeenName] = useState('Your explorer');
  const [user, setUser] = useState<{ uid: string; email: string | null; verified: boolean; anon: boolean } | null>(null);
  const [adult, setAdult] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [busy, setBusy] = useState<'' | 'approve' | 'decline'>('');
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [verifyNote, setVerifyNote] = useState('');

  useEffect(() => {
    document.title = 'A grown-up\'s OK · NatureGram';
    (async () => {
      try { const t = (await ThemeService.getDailyTheme()) || getFallbackTheme(); if (t) ThemeService.applyThemeToDOM(t as any); } catch { /* keep the default palette */ }
    })();
    return FirebaseService.subscribeToAuthChanges((u: any) => setUser(u ? { uid: u.uid, email: u.email, verified: !!u.emailVerified, anon: !!u.isAnonymous } : null));
  }, []);

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    guardianSummary(token).then(r => {
      const teen = r.data?.teen;
      if (teen) setTeenName(teen.firstName || teen.username);
      if (r.ok && r.data?.teen && r.data?.facts) { setSummary(r.data); setPhase('open'); return; }
      // A 200 that isn't the summary (an HTML fallback from a proxy, say) reads as unreachable, never a crash
      if (r.ok) { setPhase('offline'); return; }
      setPhase(r.code === 'offline' ? 'offline' : (['expired', 'used', 'replaced'].includes(String(r.code)) ? r.code : 'invalid') as Phase);
    });
  }, [token]);

  const signedIn = !!user && !user.anon;
  const decide = async (kind: 'approve' | 'decline') => {
    if (busy) return;
    setError(null);
    if (kind === 'approve' && (!adult || !guardian)) { setError({ code: 'confirm', message: 'Please tick both boxes to confirm.' }); return; }
    setBusy(kind);
    const r = kind === 'approve' ? await approveGuardian(token, adult, guardian) : await declineGuardian(token);
    setBusy('');
    if (r.ok) { setPhase(kind === 'approve' ? 'approved' : 'declined'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (['expired', 'used', 'invalid'].includes(String(r.code))) { setPhase(r.code as Phase); return; }
    setError({ code: r.code, message: r.message || 'That didn\'t work. Please try again.' });
  };
  const recheckVerified = async () => {
    if (!auth.currentUser) return;
    await reload(auth.currentUser).catch(() => {});
    const v = !!auth.currentUser?.emailVerified;
    setUser(u => (u ? { ...u, verified: v } : u));
    setVerifyNote(v ? 'Thank you, your email is verified.' : 'Not verified yet. Open the link in the email we sent, then try again.');
  };

  const card = 'ng-paper';

  const done = (heading: string, paras: React.ReactNode[], glyph: 'stamp' | 'feather' | 'compass' = 'stamp') => (
    <section className={`${card} p-6 sm:p-8`} role="status">
      <Glyph name={glyph} size={32} className="text-theme-accent" />
      <h1 className="mt-3 ng-heading text-[28px] sm:text-[32px] leading-tight">{heading}</h1>
      <div className="mt-3 flex flex-col gap-3 text-[15px] text-stone-700 leading-relaxed">{paras.map((p, i) => <p key={i}>{p}</p>)}</div>
      <a href="/feed" className="ng-button-primary mt-6">Go to NatureGram</a>
    </section>
  );

  let main: React.ReactNode;
  if (phase === 'loading') {
    main = <p className="text-stone-600 py-16 text-center" role="status">Opening the letter…</p>;
  } else if (phase === 'approved') {
    main = done(`Thank you. ${teenName}'s field page is open`, [
      `${teenName} can now share sightings with the community in teen mode: no ads or tracking, never where a sighting was made, and letters only with explorers they both follow. We've let them know.`,
      <>You can change your mind at any time. In NatureGram, open your field page, then <strong className="font-semibold text-stone-900">Settings</strong>, and you'll find <strong className="font-semibold text-stone-900">Explorers in your care</strong>. From there you can withdraw consent, which makes their field page private again, or delete their account.</>,
      'Teen mode ends on its own when they turn 18.',
    ]);
  } else if (phase === 'declined') {
    main = done('Thank you for letting us know', [
      `${teenName}'s field page stays private. They can still browse and save sightings to their own journal, but they can't share anything or write letters.`,
      'If you change your mind, they can send you a new link from the app.',
    ], 'feather');
  } else if (phase !== 'open' || !summary) {
    const copy: Record<string, [string, string]> = {
      expired: ['This link has expired', `Links last for 7 days, to keep things safe. ${teenName === 'Your explorer' ? 'Your explorer' : teenName} can send you a fresh one from the app in a moment.`],
      used: ['This link has already been used', 'Someone has already answered this request. If that was you, there\'s nothing more to do. If it wasn\'t, please write to us and we\'ll look into it straight away.'],
      replaced: ['A newer link was sent', 'This request was replaced by a newer one. Please use the link in the most recent letter.'],
      offline: ['We can\'t reach NatureGram just now', 'Please check your connection and open the link again.'],
      invalid: ['We don\'t recognise this link', 'It may have been copied only in part. Please open it straight from the letter, or ask your explorer to send a new one.'],
    };
    const [h, p] = copy[phase] || copy.invalid;
    main = done(h, [p], 'compass');
  } else {
    const f = summary.facts;
    main = (
      <>
        <header className="pt-2">
          <p className="text-[15px] text-stone-600">A request for a parent or guardian</p>
          <h1 className="mt-1 font-display text-[30px] sm:text-[38px] leading-[1.15] text-text-main">{teenName} would like to explore NatureGram</h1>
          {summary.teen.firstName && <p className="mt-2 text-sm text-stone-600">Their username is <span className="font-semibold text-stone-800">{summary.teen.username}</span>.</p>}
          <p className="mt-4 text-[16px] text-stone-700 leading-relaxed max-w-2xl">Because they are under 18, their field page is private until you say it's all right. Here is everything you need to decide. It takes about two minutes.</p>
        </header>

        <section className={`${card} p-5 sm:p-6`} aria-labelledby="g-what">
          <h2 id="g-what" className="font-display text-xl text-text-main flex items-center gap-2"><Glyph name="notebook" size={22} className="text-theme-accent" />What NatureGram is</h2>
          <p className="mt-2 text-[15px] text-stone-700 leading-relaxed">{f.what}</p>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className={`${card} p-5 sm:p-6`} aria-labelledby="g-keep">
            <h2 id="g-keep" className="font-display text-xl text-text-main">What we keep about them</h2>
            <div className="mt-3"><List items={f.collected} glyph="leaf" /></div>
          </section>
          <section className={`${card} p-5 sm:p-6`} aria-labelledby="g-never">
            <h2 id="g-never" className="font-display text-xl text-text-main">What we never keep</h2>
            <div className="mt-3"><List items={f.notCollected} glyph="feather" muted /></div>
          </section>
        </div>

        <section className={`${card} p-5 sm:p-6`} aria-labelledby="g-mode">
          <h2 id="g-mode" className="font-display text-xl text-text-main flex items-center gap-2"><Glyph name="leafCompass" size={22} className="text-theme-accent" />What teen mode does</h2>
          <div className="mt-3"><List items={f.teenMode} glyph="compass" /></div>
          <p className="mt-4 text-sm text-stone-600">It ends on its own when they turn 18.</p>
        </section>

        <section className={`${card} p-5 sm:p-6`} aria-labelledby="g-controls">
          <h2 id="g-controls" className="font-display text-xl text-text-main flex items-center gap-2"><Glyph name="stamp" size={22} className="text-theme-accent" />Your controls</h2>
          <div className="mt-3"><List items={f.controls} glyph="stamp" /></div>
        </section>

        <section className={`${card} p-5 sm:p-7 !border-theme-accent/40`} aria-labelledby="g-decide">
          <h2 id="g-decide" className="font-display text-2xl text-text-main">Your answer</h2>
          {!signedIn ? (
            <>
              <p className="mt-2 text-[15px] text-stone-700 leading-relaxed">First, sign in to your own NatureGram account, or make one. This is how we know the answer comes from a grown-up, and it's where you'll manage things later.</p>
              <div className="mt-4 max-w-md">
                <AuthModal inline adultOnly initialIsSignUp reason="Your own account, not your explorer's." onSuccess={() => setError(null)} />
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-stone-600">Signed in as <span className="font-semibold text-stone-800">{user!.email || 'your account'}</span>. <button type="button" onClick={() => FirebaseService.logout()} className="underline underline-offset-2 hover:text-stone-900 min-h-[44px]">Not you?</button></p>
              {!user!.verified && (
                <div className="mt-3 rounded-lg bg-insight-bg border border-stone-300 p-3.5 text-sm text-stone-800 leading-relaxed">
                  <p>Please verify your email address before approving. We've sent a link to your inbox.</p>
                  <div className="mt-2 flex flex-wrap gap-x-4">
                    <button type="button" onClick={async () => { await FirebaseService.sendVerificationEmail().catch(() => {}); setVerifyNote('Sent. It can take a minute or two.'); }} className="font-semibold text-theme-accent min-h-[44px]">Send the link again</button>
                    <button type="button" onClick={recheckVerified} className="font-semibold text-theme-accent min-h-[44px]">I've verified it</button>
                  </div>
                  {verifyNote && <p className="text-stone-600">{verifyNote}</p>}
                </div>
              )}
              <fieldset className="mt-4 flex flex-col gap-1">
                <legend className="sr-only">Please confirm</legend>
                <label className="flex items-start gap-3 min-h-[44px] py-2 cursor-pointer">
                  <input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} className="mt-0.5 w-5 h-5 accent-stone-900" />
                  <span className="text-[15px] text-stone-800">I'm 18 or older</span>
                </label>
                <label className="flex items-start gap-3 min-h-[44px] py-2 cursor-pointer">
                  <input type="checkbox" checked={guardian} onChange={e => setGuardian(e.target.checked)} className="mt-0.5 w-5 h-5 accent-stone-900" />
                  <span className="text-[15px] text-stone-800">I'm {teenName}'s parent or guardian</span>
                </label>
              </fieldset>
              {error && (
                <div role="alert" className="mt-2 text-sm text-red-900 bg-red-50 border-l-[3px] border-red-700 rounded-r-lg px-3.5 py-3 leading-relaxed">
                  <p>{error.message}</p>
                  {(error.code === 'same' || error.code === 'teen') && <button type="button" onClick={() => FirebaseService.logout()} className="mt-1 font-semibold underline underline-offset-2 min-h-[44px]">Sign out and use my own account</button>}
                </div>
              )}
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <button type="button" onClick={() => decide('approve')} disabled={!!busy} className="ng-button-primary min-h-[52px] sm:flex-1">{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
                <button type="button" onClick={() => decide('decline')} disabled={!!busy} className="ng-button-quiet min-h-[52px]">{busy === 'decline' ? 'One moment…' : 'Not now'}</button>
              </div>
              {/* glossary-ok: record as a verb */}
              <p className="mt-3 text-xs text-stone-500 leading-relaxed">We record that you approved, when, and from which account, so we can show consent was given. You can withdraw it at any time. <a href="/privacy.html" target="_blank" rel="noopener" className="underline underline-offset-2">Privacy policy</a></p>
            </>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-day-bg text-text-main">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-6 pb-16 flex flex-col gap-5">
        <Mark />
        {main}
        <p className="text-xs text-stone-500 text-center pt-4">NatureGram · a field notebook for the living world · <a href="/privacy.html" className="underline underline-offset-2">Privacy</a> · <a href="/terms.html" className="underline underline-offset-2">Terms</a></p>
      </div>
    </div>
  );
};

export default GuardianConsent;
