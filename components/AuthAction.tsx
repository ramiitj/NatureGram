import React, { useEffect, useMemo, useRef, useState } from 'react';
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { FirebaseService } from '../services/firebaseService';
import { getDailyTheme } from '../constants/naturalists';
import { track } from '../services/analytics';
import Glyph from './Glyph';
import SpecimenPlate, { PlateStamp } from './SpecimenPlate';

/**
 * Where the links in NatureGram's letters land: /auth/action?mode=…&oobCode=… (Firebase's action
 * handler, rebuilt on our own origin) and /welcome (the continue URL after confirming an email).
 *
 * Verifying an email is the first page someone sees from their first letter, so it is a moment,
 * not a form: the mark, "Your field page is ready", plate No. 1 waiting for a first species,
 * a line from the naturalist of the fortnight, and one clear next step.
 */

type Mode = 'verifyEmail' | 'resetPassword' | 'recoverEmail' | 'verifyAndChangeEmail' | 'welcome';
type Problem = 'expired' | 'used' | 'invalid' | 'disabled' | 'network';
type Stage =
  | { k: 'working' }
  | { k: 'verified' }
  | { k: 'reset-form'; email: string }
  | { k: 'reset-done'; email: string; signedIn: boolean }
  | { k: 'recovered'; email: string }
  | { k: 'changed'; email: string }
  | { k: 'problem'; problem: Problem };

interface Props {
  /** The address the explorer arrived on (path and query), captured before the app tidied the URL. */
  url: string;
  onDone: (to: 'lens' | 'feed') => void;
  onSignIn: () => void;
}

const problemOf = (e: any): Problem => {
  const code = String(e?.code || '');
  if (code.includes('expired')) return 'expired';
  if (code.includes('invalid-action-code')) return 'used';
  if (code.includes('user-disabled')) return 'disabled';
  if (code.includes('network')) return 'network';
  return 'invalid';
};

/** A continue URL we're happy to follow: our own origin only, never an open redirect. */
const safeContinue = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    const ours = u.origin === window.location.origin || u.hostname === 'thenaturegram.com' || u.hostname === 'www.thenaturegram.com';
    if (!ours || ['/', '/feed', '/welcome', '/auth/action'].includes(u.pathname.replace(/\/$/, '') || '/')) return null;
    return u.pathname + u.search;
  } catch { return null; }
};

const AuthAction: React.FC<Props> = ({ url, onDone, onSignIn }) => {
  const parsed = useMemo(() => {
    const u = new URL(url, window.location.origin);
    const q = u.searchParams;
    const mode = (u.pathname.startsWith('/welcome') ? 'welcome' : q.get('mode') || '') as Mode;
    return { mode, code: q.get('oobCode') || '', cont: safeContinue(q.get('continueUrl')), lang: q.get('lang') };
  }, [url]);
  const { mode, code } = parsed;
  const theme = useMemo(() => getDailyTheme(), []);
  const [stage, setStage] = useState<Stage>({ k: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // a one-time code must only be spent once (StrictMode runs effects twice)
    ran.current = true;
    if (parsed.lang) auth.languageCode = parsed.lang;
    const finishVerify = async () => {
      // Pick up the new emailVerified flag on this device straight away
      try { await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); } catch { /* signed out or offline */ }
      setStage({ k: 'verified' });
    };
    (async () => {
      try {
        if (mode === 'welcome') return await finishVerify();
        if (!code) return setStage({ k: 'problem', problem: 'invalid' });
        if (mode === 'verifyEmail') {
          await applyActionCode(auth, code);
          track('email_verified', {});
          return await finishVerify();
        }
        if (mode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, code);
          return setStage({ k: 'reset-form', email });
        }
        if (mode === 'recoverEmail') {
          const info = await checkActionCode(auth, code);
          await applyActionCode(auth, code);
          return setStage({ k: 'recovered', email: info.data.email || '' });
        }
        if (mode === 'verifyAndChangeEmail') {
          const info = await checkActionCode(auth, code);
          await applyActionCode(auth, code);
          return setStage({ k: 'changed', email: info.data.email || '' });
        }
        setStage({ k: 'problem', problem: 'invalid' });
      } catch (e: any) {
        // A used verification link on an account that is already verified is good news, not an error
        if (mode === 'verifyEmail') {
          try { await auth.currentUser?.reload(); } catch { /* ignore */ }
          if (auth.currentUser?.emailVerified) return setStage({ k: 'verified' });
        }
        setStage({ k: 'problem', problem: problemOf(e) });
      }
    })();
  }, [mode, code, parsed.lang]);

  const last = theme.naturalist.split(' ').slice(-1)[0];

  return (
    <div className="fixed inset-0 z-[150] overflow-y-auto bg-[#f3eee4] text-stone-800" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 31px, rgb(120 100 70 / 0.07) 31px 32px)' }}>
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-6 sm:py-14 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <header className={`w-full ${stage.k === 'verified' ? 'max-w-[920px]' : 'max-w-[640px]'} flex items-center gap-2.5 mb-5 sm:mb-7 px-1`}>
          <span className="w-9 h-9 rounded-[10px] bg-theme-primary text-white flex items-center justify-center shadow-sm"><Glyph name="mark" size={24} strokeWidth={1.7} /></span>
          <span className="font-display italic font-semibold text-xl text-stone-900">NatureGram</span>
        </header>

        <main className={`w-full ${stage.k === 'verified' ? 'max-w-[920px]' : 'max-w-[640px]'} bg-[#fbf7ef] rounded-[3px] p-2 shadow-[0_1px_2px_rgba(60,40,20,0.12),0_18px_40px_-18px_rgba(60,40,20,0.35)] animate-slide-up`}>
          <div className="border border-[#d8ccb6] outline outline-1 outline-offset-[3px] outline-[#e8dfcd] rounded-[2px] px-5 py-6 sm:px-10 sm:py-10">
            {stage.k === 'working' && <Working mode={mode} />}

            {stage.k === 'verified' && (
              <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-12 items-center">
                <div>
                  <p className="text-[15px] text-stone-500">Email confirmed</p>
                  <h1 className="font-display text-[32px] sm:text-[44px] leading-[1.1] font-medium text-stone-900 mt-1.5">Your field page is ready</h1>
                  <p className="text-[17px] leading-relaxed text-stone-700 mt-4 max-w-[34ch]">
                    It starts blank on purpose. Go outside, look closely at one living thing, and it becomes No. 1 on your life list.
                  </p>
                  <NaturalistLine quote={theme.quote} by={theme.naturalist} />
                  <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
                    <button onClick={() => onDone('lens')} className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-theme-primary text-white text-[15px] font-semibold shadow-sm hover:opacity-95 active:scale-[0.98] transition">
                      <Glyph name="eyeEar" size={20} strokeWidth={1.7} />Open the Lens
                    </button>
                    <button onClick={() => parsed.cont ? window.location.assign(parsed.cont) : onDone('feed')} className="px-4 py-3 text-[15px] font-semibold text-stone-600 hover:text-stone-900">
                      {parsed.cont ? 'Back to where you were' : 'Look around the feed first'}
                    </button>
                  </div>
                </div>
                <div className="flex justify-center lg:justify-end order-first lg:order-none">
                  <div className="w-[148px] sm:w-[230px] lg:w-[290px] -rotate-[2.5deg] mt-2 lg:mt-0">
                    <SpecimenPlate size="lg" data={{ name: 'Your first species', no: 1 }} stamp={<PlateStamp tone="accent">Waiting for you</PlateStamp>} />
                  </div>
                </div>
              </div>
            )}

            {stage.k === 'reset-form' && <ResetForm email={stage.email} code={code} onSaved={(signedIn) => setStage({ k: 'reset-done', email: stage.email, signedIn })} onProblem={(p) => setStage({ k: 'problem', problem: p })} />}

            {stage.k === 'reset-done' && (
              <Moment glyph="notebook" kicker="Password saved" title={stage.signedIn ? "You're back in" : 'Your new password is set'}
                body={stage.signedIn ? 'Your sightings, life list and letters are right where you left them.' : `Sign in with ${stage.email} and your new password, and your field page is right where you left it.`}>
                {stage.signedIn
                  ? <Primary onClick={() => onDone('feed')}>Back to the wild</Primary>
                  : <Primary onClick={onSignIn}>Sign in</Primary>}
                <NaturalistLine quote={theme.quote} by={theme.naturalist} />
              </Moment>
            )}

            {stage.k === 'recovered' && <Recovered email={stage.email} onDone={() => onDone('feed')} />}

            {stage.k === 'changed' && (
              <Moment glyph="letter" kicker="Email updated" title="Your new address is set"
                body={`Letters from NatureGram will go to ${stage.email || 'your new address'} from now on. Sign in again with it to carry on.`}>
                <Primary onClick={onSignIn}>Sign in</Primary>
              </Moment>
            )}

            {stage.k === 'problem' && <ProblemView problem={stage.problem} mode={mode} onSignIn={onSignIn} onDone={() => onDone('feed')} />}
          </div>
        </main>

        <p className="mt-5 text-[13px] text-stone-500 text-center max-w-[64ch] px-2">
          {last}'s fortnight on NatureGram · a field notebook for the living world
        </p>
      </div>
    </div>
  );
};

// ---- Pieces --------------------------------------------------------------------------------------

const NaturalistLine: React.FC<{ quote: string; by: string }> = ({ quote, by }) => (
  <figure className="mt-6 border-l-2 border-theme-accent pl-4 max-w-[46ch]">
    <blockquote className="font-display italic text-[17px] leading-snug text-stone-700">“{quote}”</blockquote>
    <figcaption className="mt-1.5 text-[13px] text-stone-500">{by}, naturalist of the fortnight</figcaption>
  </figure>
);

const Primary: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...rest }) => (
  <button {...rest} className={`inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-theme-primary text-white text-[15px] font-semibold shadow-sm hover:opacity-95 active:scale-[0.98] transition disabled:opacity-60 ${className}`}>{children}</button>
);

const Moment: React.FC<{ glyph: React.ComponentProps<typeof Glyph>['name']; kicker: string; title: string; body: React.ReactNode; children?: React.ReactNode }> = ({ glyph, kicker, title, body, children }) => (
  <div className="max-w-[560px] mx-auto text-center sm:text-left sm:mx-0">
    <Glyph name={glyph} size={38} className="text-theme-accent mx-auto sm:mx-0" />
    <p className="text-[15px] text-stone-500 mt-4">{kicker}</p>
    <h1 className="font-display text-[30px] sm:text-[38px] leading-[1.15] font-medium text-stone-900 mt-1">{title}</h1>
    <div className="text-[17px] leading-relaxed text-stone-700 mt-3">{body}</div>
    <div className="mt-7 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 [&>figure]:basis-full [&>figure]:text-left">{children}</div>
  </div>
);

const Working: React.FC<{ mode: Mode }> = ({ mode }) => (
  <div className="py-14 flex flex-col items-center text-center" role="status" aria-live="polite">
    <svg viewBox="0 0 48 48" width={44} height={44} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="press-leaf text-theme-primary/50" aria-hidden="true">
      <path d="M24 42C12 36 9 24 14 13c6 1 17 5 20 15 2 7-3 12-10 14z" /><path d="M24 42c-1-9-4-17-9-26M20 30l-6-1M22 24l6-3" />
    </svg>
    <p className="font-display italic text-xl text-stone-600 mt-4">{mode === 'resetPassword' ? 'Checking your link…' : mode === 'welcome' ? 'Opening your field page…' : 'Opening your letter…'}</p>
  </div>
);

const ResetForm: React.FC<{ email: string; code: string; onSaved: (signedIn: boolean) => void; onProblem: (p: Problem) => void }> = ({ email, code, onSaved, onProblem }) => {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) { setError('Use at least 6 characters. A short phrase you will remember works well.'); return; }
    setBusy(true); setError('');
    try {
      await confirmPasswordReset(auth, code, pw);
      track('password_reset_done', {});
    } catch (err: any) {
      setBusy(false);
      const c = String(err?.code || '');
      if (c.includes('weak-password') || c.includes('password-does-not-meet')) { setError('That one is a little easy to guess. Try something longer.'); return; }
      if (c.includes('network')) { setError("We couldn't reach the server. Check your connection and try again."); return; }
      onProblem(problemOf(err)); return;
    }
    let signedIn = false;
    try { await FirebaseService.loginUser(email, pw); signedIn = true; } catch { /* they can sign in themselves */ }
    onSaved(signedIn);
  };
  return (
    <form onSubmit={submit} className="max-w-[460px]" noValidate>
      <Glyph name="feather" size={38} className="text-theme-accent" />
      <p className="text-[15px] text-stone-500 mt-4">Reset your password</p>
      <h1 className="font-display text-[30px] sm:text-[38px] leading-[1.15] font-medium text-stone-900 mt-1">Choose a new password</h1>
      <p className="text-[16px] text-stone-700 mt-3">For <span className="font-semibold text-stone-900 break-all">{email}</span></p>
      <label htmlFor="new-pw" className="block text-[14px] font-semibold text-stone-700 mt-6">New password</label>
      <div className="mt-1.5 relative">
        <input id="new-pw" autoFocus type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={e => { setPw(e.target.value); setError(''); }}
          className="w-full rounded-xl border border-[#d8ccb6] bg-white pl-4 pr-20 py-3.5 text-[16px] focus:border-theme-accent" aria-invalid={!!error} aria-describedby="pw-help" />
        <button type="button" onClick={() => setShow(s => !s)} className="absolute right-1 top-1/2 -translate-y-1/2 px-3 py-2 text-[14px] font-semibold text-stone-500 hover:text-stone-800" aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
      </div>
      <p id="pw-help" className={`text-[14px] mt-2 ${error ? 'text-[rgb(var(--theme-accent-rgb))]' : 'text-stone-500'}`} role={error ? 'alert' : undefined}>
        {error || 'At least 6 characters. You will be signed in straight after.'}
      </p>
      <Primary type="submit" disabled={busy} className="mt-6 w-full sm:w-auto">{busy ? 'Saving…' : 'Save and carry on'}</Primary>
    </form>
  );
};

const Recovered: React.FC<{ email: string; onDone: () => void }> = ({ email, onDone }) => {
  const [sent, setSent] = useState<'idle' | 'busy' | 'sent' | 'failed'>('idle');
  const reset = async () => {
    setSent('busy');
    try { await FirebaseService.sendPasswordReset(email); setSent('sent'); } catch { setSent('failed'); }
  };
  return (
    <Moment glyph="compass" kicker="Email restored" title="Your email is back as it was"
      body={<>Letters will go to <span className="font-semibold text-stone-900 break-all">{email || 'your original address'}</span> again. If you didn't ask for the change, someone may know your password. Choosing a new one keeps your field page safe.</>}>
      {sent === 'sent'
        ? <p className="text-[16px] text-stone-700" role="status">A reset letter is on its way. It can take a minute or two.</p>
        : <Primary onClick={reset} disabled={sent === 'busy' || !email}>{sent === 'busy' ? 'Sending…' : 'Reset my password'}</Primary>}
      {sent === 'failed' && <p className="text-[14px] text-[rgb(var(--theme-accent-rgb))]" role="alert">That didn't go through. Please try again in a moment.</p>}
      <button onClick={onDone} className="px-4 py-3 text-[15px] font-semibold text-stone-600 hover:text-stone-900">Go to the feed</button>
    </Moment>
  );
};

const PROBLEM_COPY: Record<Problem, { title: string; body: string }> = {
  expired: { title: 'This link has gone stale', body: 'Links in our letters only work for a while, so nobody else can use them later. A fresh one takes a moment.' },
  used: { title: 'This link has already been used', body: 'Each link works once. If it was you a moment ago, you are all set. If not, ask for a new one.' },
  invalid: { title: "This link didn't come through whole", body: 'Part of it may have been cut off on the way, which happens with some mail apps. A new link usually fixes it.' },
  disabled: { title: 'This account is paused', body: 'It has been switched off for now. If you think that is a mistake, reply to any letter from us and we will take a look.' },
  network: { title: "We couldn't reach NatureGram", body: 'Check your connection and open the link again. It still works until it expires.' },
};

const ProblemView: React.FC<{ problem: Problem; mode: Mode; onSignIn: () => void; onDone: () => void }> = ({ problem, mode, onSignIn, onDone }) => {
  const copy = PROBLEM_COPY[problem];
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'failed' | 'limited'>('idle');
  const user = auth.currentUser;
  const [email, setEmail] = useState(user?.email || '');
  const isReset = mode === 'resetPassword';
  const canResend = problem !== 'disabled' && problem !== 'network' && (mode === 'verifyEmail' || mode === 'resetPassword' || mode === 'welcome');
  const signedInUnverified = !!user && !user.isAnonymous && !user.emailVerified;

  const resend = async () => {
    setState('busy');
    try {
      if (isReset) await FirebaseService.sendPasswordReset(email.trim());
      else await FirebaseService.sendVerificationEmail();
      setState('sent');
    } catch (e: any) { setState(String(e?.code || '').includes('too-many') ? 'limited' : 'failed'); }
  };

  return (
    <div className="max-w-[540px]">
      <Glyph name="sealed" size={38} className="text-theme-accent" />
      <h1 className="font-display text-[30px] sm:text-[38px] leading-[1.15] font-medium text-stone-900 mt-4">{copy.title}</h1>
      <p className="text-[17px] leading-relaxed text-stone-700 mt-3">{copy.body}</p>

      {state === 'sent' ? (
        <div className="mt-7 rounded-xl bg-white/70 border border-[#e3d9c6] p-4" role="status">
          <p className="font-display text-lg text-stone-900">A new letter is on its way</p>
          <p className="text-[15px] text-stone-600 mt-1">{isReset ? `If there's an account for ${email.trim()}, it will be there in a minute or two.` : `Look for it at ${user?.email}. It can take a minute or two, and sometimes lands in spam.`}</p>
        </div>
      ) : canResend ? (
        <div className="mt-7">
          {isReset && (
            <>
              <label htmlFor="reset-email" className="block text-[14px] font-semibold text-stone-700">Your email</label>
              <input id="reset-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                className="mt-1.5 mb-4 w-full rounded-xl border border-[#d8ccb6] bg-white px-4 py-3.5 text-[16px] outline-none focus:border-theme-accent" />
            </>
          )}
          {isReset || signedInUnverified
            ? <Primary onClick={resend} disabled={state === 'busy' || (isReset && !/\S+@\S+\.\S+/.test(email))}>{state === 'busy' ? 'Sending…' : 'Send me a new link'}</Primary>
            : user && !user.isAnonymous && user.emailVerified
              ? <Primary onClick={onDone}>Your email is already confirmed. Open the feed</Primary>
              : <Primary onClick={onSignIn}>Sign in to get a new link</Primary>}
          {state === 'limited' && <p className="text-[14px] text-stone-600 mt-3" role="alert">We've sent a few already. Give the last one a little while to arrive, then try again.</p>}
          {state === 'failed' && <p className="text-[14px] text-[rgb(var(--theme-accent-rgb))] mt-3" role="alert">That didn't go through. Please try again in a moment.</p>}
        </div>
      ) : null}

      <button onClick={onDone} className="mt-4 px-0 py-2 text-[15px] font-semibold text-stone-600 hover:text-stone-900 underline decoration-stone-300 underline-offset-4">Go to the feed</button>
    </div>
  );
};

export default AuthAction;
