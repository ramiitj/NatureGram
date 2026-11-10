import React, { useEffect, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { track } from '../services/analytics';
import Glyph, { GlyphName } from './Glyph';
import SpecimenPlate from './SpecimenPlate';
import { getDailyTheme } from '../constants/naturalists';
import { adultFromOf, requestGuardian, shareGuardianLink, RequestSent } from '../services/guardian';

interface AuthModalProps {
  onClose?: () => void;
  onSuccess: () => void;
  inline?: boolean;
  initialIsSignUp?: boolean;
  /** Why we're asking, shown at the top ("Create an account to comment") */
  reason?: string;
  /** Only 18+ may sign up here (a parent approving a teen's notebook) */
  adultOnly?: boolean;
}

const friendlyError = (code: string, isSignUp: boolean): string => {
  switch (code) {
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use': return 'There\'s already a NatureGram account for this email. Try logging in instead.';
    case 'auth/invalid-email': return 'That email address doesn\'t look quite right. Could you check it?';
    case 'auth/weak-password': return 'Your password needs at least 8 characters.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials': return 'That email and password don\'t match. Check them, or reset your password.';
    case 'auth/too-many-requests': return 'That\'s a lot of tries in a row. Take a breath and try again in a minute.';
    case 'auth/network-request-failed': return 'We can\'t reach the internet just now. Check your connection and try again.';
    case 'auth/user-disabled': return 'This account has been switched off. If you think that\'s a mistake, please get in touch.';
    default: return isSignUp ? 'Something went wrong while making your account. Please try again.' : 'Something went wrong while logging you in. Please try again.';
  }
};

/** The one-tap way forward an error can offer, if any. */
const errorAction = (code: string): 'login' | 'reset' | null => {
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') return 'login';
  if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(code)) return 'reset';
  return null;
};

// ---------------------------------------------------------------- 13+ age check at sign-up
// We ask for month and year of birth, work out the age here, and keep only the answer
// (ageConfirmed: true and when). The date itself is never sent or stored.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AGE_BLOCK_KEY = 'ng_age_block_until';
/** Age in whole years on today's date for someone born in that month (counted from the end of it, to be safe). */
export const ageFrom = (month: number, year: number, now = new Date()) => {
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 <= month) age -= 1; // birthday month not finished yet
  return age;
};
const ageBlocked = () => { try { return Number(localStorage.getItem(AGE_BLOCK_KEY) || 0) > Date.now(); } catch { return false; } };

/**
 * The threshold into NatureGram. Sign-up shows what you're joining (an empty plate waiting to become
 * No. 1 on your life list, a notebook, letters); log in welcomes you back with a line from the
 * naturalist of the fortnight. Every mode keeps the same paper, type and voice.
 */
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

const AuthModal: React.FC<AuthModalProps> = ({ onClose, onSuccess, inline, initialIsSignUp = true, reason, adultOnly }) => {
  const initialMode = initialIsSignUp ? 'signup' : 'login';
  const [mode, setMode] = useState<'signup' | 'login' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [tooYoung, setTooYoung] = useState(ageBlocked);
  // 13 to 17: one more step, a parent or guardian's email; then what happened to the request
  const [step, setStep] = useState<'form' | 'guardian' | 'sent'>('form');
  const [parentEmail, setParentEmail] = useState('');
  const [guardianSent, setGuardianSent] = useState<RequestSent | null>(null);
  const [guardianIssue, setGuardianIssue] = useState('');
  const [shared, setShared] = useState('');
  const isSignUp = mode === 'signup';
  const thisYear = new Date().getFullYear();
  // The naturalist of the fortnight: the same rotation the app's palette and landing follow
  const [naturalist] = useState(() => { try { return getDailyTheme(); } catch { return null; } });
  // registerUser links a guest account rather than replacing it, so a guest's sightings come along
  const [isGuest] = useState(() => { try { return !!FirebaseService.getCurrentUserId() && FirebaseService.isCurrentUserAnonymous(); } catch { return false; } });

  // Not on the parent's consent page, where the form sits far down and focusing it would jump past the explanation
  useEffect(() => { if (!adultOnly) firstFieldRef.current?.focus(); }, [mode, adultOnly]);
  useEffect(() => {
    if (inline || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inline, onClose]);

  const passwordOk = password.length >= 8;
  const usernameOk = !username || /^[a-zA-Z0-9_.]{3,30}$/.test(username);

  const fail = (msg: string, code = '') => { setError(msg); setErrorCode(code); };
  const switchMode = (m: 'signup' | 'login' | 'reset') => { setMode(m); setError(''); setErrorCode(''); setStep('form'); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(''); setErrorCode(''); setNotice('');
    if (mode === 'signup' && !passwordOk) { fail('Your password needs at least 8 characters.'); return; }
    if (mode === 'signup' && !usernameOk) { fail('Usernames can use 3 to 30 letters, numbers, dots or underscores.'); return; }
    if (mode === 'signup') {
      if (ageBlocked()) { setTooYoung(true); return; }
      if (!birthMonth || !birthYear) { fail('Please choose the month and year you were born.'); return; }
      if (ageFrom(Number(birthMonth), Number(birthYear)) < 13) {
        // Remember on this device for a day, so the answer can't simply be changed and resubmitted
        try { localStorage.setItem(AGE_BLOCK_KEY, String(Date.now() + 86_400_000)); } catch { /* storage unavailable */ }
        track('sign_up_age_blocked');
        setTooYoung(true);
        return;
      }
      const age = ageFrom(Number(birthMonth), Number(birthYear));
      if (age < 18 && adultOnly) { fail('To give consent for an explorer you need to be 18 or older.'); return; }
      if (age < 18 && step === 'form') { setStep('guardian'); return; }
      if (age < 18 && step === 'guardian') {
        if (!looksLikeEmail(parentEmail)) { fail('That email address doesn\'t look quite right. Could you check it?'); return; }
        if (parentEmail.trim().toLowerCase() === email.trim().toLowerCase()) { fail('That\'s your own email. Please ask a parent or guardian for theirs.'); return; }
      }
    }
    setLoading(true);
    try {
      if (mode === 'reset') {
        await FirebaseService.sendPasswordReset(email);
        setNotice('If there\'s an account for this email, a reset link is on its way. It can take a minute or two.');
        setMode('login');
      } else if (mode === 'signup') {
        const teen = ageFrom(Number(birthMonth), Number(birthYear)) < 18;
        // Only the band is kept (and, for a teen, the month they turn 18), never the date of birth
        await FirebaseService.registerUser(email, password, username, teen
          ? { ageConfirmed: true, ageBand: 'teen', adultFrom: adultFromOf(Number(birthMonth), Number(birthYear)) }
          : { ageConfirmed: true, ageBand: 'adult' });
        if (teen) {
          // No analytics for teens, so nothing is tracked here
          const r = await requestGuardian(parentEmail.trim());
          if (r.ok && r.data) setGuardianSent(r.data); else setGuardianIssue(r.message || 'We couldn\'t send it just now.');
          setStep('sent');
          return;
        }
        track('sign_up', { with_username: !!username });
        // The naturalist persona is offered later (after a few sightings), not straight after sign-up
        onSuccess();
      } else {
        await FirebaseService.loginUser(email, password);
        track('login');
        onSuccess();
      }
    } catch (err: any) {
      const code = err?.code || '';
      fail(friendlyError(code, isSignUp), code);
    } finally {
      setLoading(false);
    }
  };

  const blocked = mode === 'signup' && tooYoung;
  const teenStep = mode === 'signup' && !blocked && step !== 'form';
  const title = blocked ? 'Not quite yet'
    : teenStep ? (step === 'guardian' ? 'A grown-up\'s OK' : 'Your notebook is ready')
    : mode === 'signup' ? (isGuest ? 'Keep your field notebook' : 'Start your field notebook')
    : mode === 'login' ? 'Welcome back to the field' : 'Reset your password';
  // The reason was written for the mode we opened in ("Create an account to comment"), so it isn't repeated after switching
  const subtitle = blocked ? '' : teenStep ? (step === 'guardian' ? 'One more step, because you\'re under 18.' : 'It stays private until your grown-up says yes.') : (reason && mode === initialMode ? reason : '') || (
    mode === 'signup' ? 'Free, and yours to keep.'
    : mode === 'login' ? 'Your pages, life list and letters are just where you left them.' : 'Tell us your email and we\'ll send a link to choose a new password.');
  const headGlyph: GlyphName = blocked ? 'feather' : teenStep ? (step === 'guardian' ? 'stamp' : 'letter') : mode === 'reset' ? 'key' : mode === 'login' ? 'compass' : 'notebook';
  // The threshold panel: what you're joining (sign-up), or who keeps the notebook this fortnight (log in)
  const wide = !inline && !blocked && mode !== 'reset';

  const inputClass = 'w-full min-h-[48px] bg-white border border-stone-300 rounded-lg px-3.5 py-3 text-base text-text-main placeholder:text-stone-400 focus:border-theme-accent transition-colors';
  const labelClass = 'block text-sm font-semibold text-stone-700 mb-1.5';
  const linkBtn = 'inline-flex items-center min-h-[44px] px-1 font-semibold text-theme-accent underline-offset-4 hover:underline';

  const epigraph = naturalist?.quote ? (
    <figure>
      <blockquote className="font-display italic text-[15px] leading-snug text-stone-700">“{naturalist.quote}”</blockquote>
      <figcaption className="mt-1.5 text-xs text-[#8a7a60]">{naturalist.naturalist}, naturalist of the fortnight</figcaption>
    </figure>
  ) : null;

  // On a phone the sign-up preview is a small cream card under the title; from md up the title, the
  // preview and the naturalist's line share one cream page on the left, with the form on the right.
  const threshold = wide ? (
    <aside
      aria-label={mode === 'signup' ? 'What you\'re joining' : 'This fortnight'}
      className={`flex-col gap-4 md:flex-1 md:mt-7 ${mode === 'signup' && !teenStep ? 'flex mx-6 mt-5 p-4 bg-[#fbf7ef] border border-[#e8dfcd] rounded-[3px] md:m-0 md:mt-7 md:p-0 md:bg-transparent md:border-0' : 'hidden md:flex'}`}
    >
      {mode === 'signup' && (
        <div className="flex gap-4 items-center md:flex-col md:items-start md:gap-5">
          <div className="w-[88px] md:w-[132px] shrink-0 -rotate-2 md:ml-1" aria-hidden="true">
            <SpecimenPlate ghost size="sm" data={{ name: 'Your first species', no: 1 }} />
          </div>
          <ul className="flex flex-col gap-2 md:gap-3 text-[13px] md:text-sm text-stone-700 leading-snug" role="list">
            <li className="flex items-center gap-2.5"><Glyph name="notebook" size={20} className="text-theme-accent" />A field notebook for every outing</li>
            <li className="flex items-center gap-2.5"><Glyph name="plate" size={20} className="text-theme-accent" />A life list, species by species</li>
            <li className="flex items-center gap-2.5"><Glyph name="sealed" size={20} className="text-theme-accent" />Letters with other explorers</li>
          </ul>
        </div>
      )}
      {mode === 'signup' && isGuest && <p className="text-[13px] text-stone-600 leading-snug">Everything you've found as a guest comes with you.</p>}
      {epigraph && <div className="hidden md:block mt-auto pt-4 border-t border-[#e8dfcd]">{epigraph}</div>}
    </aside>
  ) : null;

  const content = (
    <div className={`w-full bg-[#fcfaf8] text-left ${inline ? 'rounded-2xl' : `rounded-[1.25rem] shadow-2xl relative max-h-[92dvh] overflow-y-auto overscroll-contain ${wide ? 'md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:max-h-[90dvh]' : ''}`}`}>
      {!inline && onClose && (
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-2 right-2 z-10 w-11 h-11 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-900/5 hover:text-stone-800">
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      )}

      <div className={wide ? 'md:flex md:bg-[#fbf7ef] md:border-r md:border-[#e8dfcd] md:p-6' : ''}>
        <div className={wide ? 'md:flex-1 md:flex md:flex-col md:border md:border-[#d8ccb6] md:outline md:outline-1 md:outline-offset-[3px] md:outline-[#e8dfcd] md:rounded-[2px] md:p-6' : ''}>
          <header className={`${inline ? 'px-1 pt-1' : 'px-6 pt-6 pr-14'} ${wide ? 'md:p-0' : ''}`}>
            <Glyph name={headGlyph} size={28} className="text-theme-accent mb-3" />
            <h2 id="auth-title" className="text-[26px] md:text-[28px] leading-tight font-display font-semibold text-text-main">{title}</h2>
            {subtitle && <p className="text-stone-600 text-[15px] mt-1.5 leading-relaxed">{subtitle}</p>}
            {mode === 'login' && !inline && epigraph && <div className="md:hidden mt-4 pl-3 border-l-2 border-theme-accent/40">{epigraph}</div>}
          </header>
          {threshold}
        </div>
      </div>

      <div className={`${inline ? 'px-1 pb-1 pt-5' : 'px-6 pb-6 pt-5'} ${wide ? 'md:self-center md:px-9 md:py-9' : ''}`}>
        {teenStep && step === 'sent' ? (
          <div role="status" className="space-y-4">
            {guardianSent?.sent ? (
              <p className="text-[15px] text-stone-700 leading-relaxed">We've written to <strong className="font-semibold text-text-main">{guardianSent.to}</strong>. When they say yes, your notebook opens to the community. Their link works for 7 days.</p>
            ) : guardianSent?.link ? (
              <>
                <p className="text-[15px] text-stone-700 leading-relaxed">Send this link to your parent or guardian. It explains NatureGram and what we keep, and takes them about two minutes. It works for 7 days.</p>
                <button type="button" onClick={async () => { const r = await shareGuardianLink(guardianSent.link!, username); setShared(r === 'copied' ? 'Link copied. Paste it into a message to them.' : r === 'shared' ? 'Sent. Thank you.' : ''); }} className="w-full min-h-[52px] bg-theme-primary text-white font-semibold text-base py-3.5 rounded-xl hover:opacity-90 flex items-center justify-center gap-2">
                  <Glyph name="sealed" size={20} />Send this to your parent
                </button>
                {shared && <p className="text-sm text-stone-600">{shared}</p>}
              </>
            ) : (
              <p className="text-sm text-red-900 bg-red-50 border-l-[3px] border-red-700 rounded-r-lg px-3.5 py-3 leading-relaxed">{guardianIssue || 'We couldn\'t send it just now.'} You can send it again from your notebook.</p>
            )}
            <div className="rounded-[3px] bg-[#fbf7ef] border border-[#e8dfcd] p-4">
              <p className="text-sm font-semibold text-stone-800">While you wait, you can</p>
              <ul className="mt-2 flex flex-col gap-2 text-sm text-stone-700" role="list">
                <li className="flex items-center gap-2.5"><Glyph name="binoculars" size={18} className="text-theme-accent" />Browse the feed, Moments and Explore</li>
                <li className="flex items-center gap-2.5"><Glyph name="eyeEar" size={18} className="text-theme-accent" />Use the Lens and ask the guide</li>
                <li className="flex items-center gap-2.5"><Glyph name="notebook" size={18} className="text-theme-accent" />Keep sightings in your own journal</li>
              </ul>
            </div>
            <button type="button" onClick={onSuccess} className={`w-full min-h-[52px] font-semibold text-base py-3.5 rounded-xl ${guardianSent?.link ? 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50' : 'bg-theme-primary text-white hover:opacity-90'}`}>Open my notebook</button>
          </div>
        ) : blocked ? (
          <div role="status" className="space-y-3">
            <p className="font-display text-lg text-text-main">Thank you for wanting to join.</p>
            <p className="text-sm text-stone-600 leading-relaxed">NatureGram accounts are for explorers aged 13 and over, so we can't make one for you yet. You can still look at sightings shared by the community, and we'd love to welcome you when you're 13.</p>
            <p className="text-sm text-stone-600 leading-relaxed">Until then, a notebook and a pencil make a wonderful field journal. Ask a parent or teacher to explore with you.</p>
            {onClose && <button type="button" onClick={onClose} className="mt-2 w-full min-h-[48px] border border-stone-300 bg-white text-stone-800 font-semibold text-base py-3 rounded-xl hover:bg-stone-50">Back to exploring</button>}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate={false}>
            {teenStep && step === 'guardian' && (
              <>
                <p className="text-[15px] text-stone-700 leading-relaxed">Because you're under 18, a parent or guardian needs to say it's all right before your notebook can be shared. Until then you can explore everything and keep sightings in your own journal.</p>
                <div>
                  <label htmlFor="auth-parent-email" className={labelClass}>Your parent or guardian's email</label>
                  <input id="auth-parent-email" autoFocus type="email" inputMode="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} required autoComplete="off" placeholder="grown-up@example.com" className={inputClass} aria-describedby="auth-parent-hint" />
                  <p id="auth-parent-hint" className="text-xs mt-1.5 text-stone-500 leading-relaxed">We'll send them one letter explaining NatureGram and what we keep. Their address is used for nothing else.</p>
                </div>
                <ul className="flex flex-col gap-2 text-[13px] text-stone-700 leading-snug rounded-[3px] bg-[#fbf7ef] border border-[#e8dfcd] p-3.5" role="list" aria-label="Teen mode">
                  <li className="flex items-center gap-2.5"><Glyph name="feather" size={18} className="text-theme-accent" />No ads, and nothing that tracks you</li>
                  <li className="flex items-center gap-2.5"><Glyph name="leafCompass" size={18} className="text-theme-accent" />Where you found something is never shown</li>
                  <li className="flex items-center gap-2.5"><Glyph name="sealed" size={18} className="text-theme-accent" />Letters only with explorers you both follow</li>
                </ul>
              </>
            )}
            {!teenStep && mode === 'signup' && (
              <div>
                <label htmlFor="auth-username" className={labelClass}>Username <span className="font-normal text-stone-500">(optional)</span></label>
                <input id="auth-username" ref={firstFieldRef} type="text" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="e.g. owl_watcher" className={inputClass} aria-invalid={!usernameOk} aria-describedby={usernameOk ? undefined : 'auth-username-hint'} />
                {!usernameOk && <p id="auth-username-hint" className="text-xs mt-1.5 text-red-800">3 to 30 letters, numbers, dots or underscores.</p>}
              </div>
            )}
            {!teenStep && mode === 'signup' && (
              <fieldset>
                <legend className={labelClass}>Month and year you were born</legend>
                <div className="flex gap-2">
                  <label htmlFor="auth-birth-month" className="sr-only">Birth month</label>
                  <select id="auth-birth-month" value={birthMonth} onChange={e => setBirthMonth(e.target.value)} required aria-describedby="auth-birth-hint" className={`${inputClass} flex-[3]`}>
                    <option value="">Month</option>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <label htmlFor="auth-birth-year" className="sr-only">Birth year</label>
                  <select id="auth-birth-year" value={birthYear} onChange={e => setBirthYear(e.target.value)} required aria-describedby="auth-birth-hint" className={`${inputClass} flex-[2]`}>
                    <option value="">Year</option>
                    {Array.from({ length: 100 }, (_, i) => thisYear - i).map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <p id="auth-birth-hint" className="text-xs mt-1.5 text-stone-500">Only used to check you're 13 or older. We don't keep it.</p>
              </fieldset>
            )}
            <div className={teenStep ? 'hidden' : ''}>
              <label htmlFor="auth-email" className={labelClass}>Email</label>
              <input id="auth-email" ref={mode === 'signup' ? undefined : firstFieldRef} type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" className={inputClass} />
            </div>
            {mode !== 'reset' && (
              <div className={teenStep ? 'hidden' : ''}>
                <div className="flex items-center justify-between mb-1.5 min-h-[20px]">
                  <label htmlFor="auth-password" className="block text-sm font-semibold text-stone-700">Password</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => switchMode('reset')} className={`${linkBtn} text-sm -my-3 -mr-1`}>Forgot password?</button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={mode === 'signup' ? 8 : undefined}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    className={`${inputClass} pr-12`}
                    aria-describedby={mode === 'signup' ? 'pw-hint' : undefined}
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-stone-500 hover:text-stone-800">
                    <span className="material-symbols-outlined" aria-hidden="true">{showPassword ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
                {mode === 'signup' && (
                  <p id="pw-hint" className={`text-xs mt-1.5 flex items-center gap-1 ${passwordOk ? 'text-theme-accent font-semibold' : 'text-stone-500'}`}>
                    {passwordOk && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                    At least 8 characters
                  </p>
                )}
              </div>
            )}

            {error && (
              <div role="alert" className="text-sm text-red-900 bg-red-50 border-l-[3px] border-red-700 rounded-r-lg px-3.5 py-3 leading-relaxed">
                <p>{error}</p>
                {errorAction(errorCode) === 'login' && mode === 'signup' && <button type="button" onClick={() => switchMode('login')} className={`${linkBtn} -my-2 -ml-1`}>Log in instead</button>}
                {errorAction(errorCode) === 'reset' && mode === 'login' && <button type="button" onClick={() => switchMode('reset')} className={`${linkBtn} -my-2 -ml-1`}>Reset my password</button>}
              </div>
            )}
            {notice && (
              <p role="status" className="flex gap-2.5 items-start text-sm text-stone-800 bg-insight-bg border border-theme-accent/25 rounded-lg px-3.5 py-3 leading-relaxed">
                <Glyph name="sealed" size={20} className="text-theme-accent mt-px" />
                <span>{notice}</span>
              </p>
            )}

            <button type="submit" disabled={loading} aria-busy={loading} className="w-full min-h-[52px] bg-theme-primary text-white font-semibold text-base py-3.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60 active:scale-[0.98]">
              {loading
                ? (mode === 'signup' ? 'Opening your notebook…' : mode === 'login' ? 'Logging you in…' : 'Sending…')
                : mode === 'signup' ? (isGuest ? 'Keep my notebook' : 'Start my notebook') : mode === 'login' ? 'Log in' : 'Send reset link'}
            </button>
            {teenStep && step === 'guardian' && <button type="button" onClick={() => { setStep('form'); setError(''); }} className={`${linkBtn} self-center text-sm`}>Back</button>}
          </form>
        )}

        {mode === 'signup' && !blocked && !teenStep && !inline && epigraph && <div className="md:hidden mt-6 pt-4 border-t border-[#e8dfcd]">{epigraph}</div>}

        <div className={`mt-4 text-center text-sm text-stone-600 ${step === 'sent' && mode === 'signup' ? 'hidden' : ''}`}>
          {mode === 'signup' ? (
            <>Already keep a notebook here? <button type="button" onClick={() => switchMode('login')} className={linkBtn}>Log in</button></>
          ) : mode === 'reset' ? (
            <>Remembered it? <button type="button" onClick={() => switchMode('login')} className={linkBtn}>Back to log in</button></>
          ) : (
            <>New to NatureGram? <button type="button" onClick={() => switchMode('signup')} className={linkBtn}>Start a field notebook</button></>
          )}
        </div>
        {mode === 'signup' && (
          <p className="mt-2 text-xs text-stone-500 text-center leading-relaxed">
            By joining you agree to our <a href="/terms.html" target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-stone-800">Terms</a> and <a href="/privacy.html" target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-stone-800">Privacy Policy</a>, and confirm you are 13 or older.
          </p>
        )}
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className="absolute inset-0 bg-stone-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true"></div>
      <div className={`relative z-10 w-full ${wide ? 'max-w-sm md:max-w-3xl' : 'max-w-sm'}`}>{content}</div>
    </div>
  );
};

export default AuthModal;
