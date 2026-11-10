import React, { useEffect, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { track } from '../services/analytics';

interface AuthModalProps {
  onClose?: () => void;
  onSuccess: () => void;
  inline?: boolean;
  initialIsSignUp?: boolean;
  /** Why we're asking, shown at the top ("Create an account to comment") */
  reason?: string;
}

const friendlyError = (code: string, isSignUp: boolean): string => {
  switch (code) {
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use': return 'An account with this email already exists. Try logging in instead.';
    case 'auth/invalid-email': return 'That email address doesn\'t look right.';
    case 'auth/weak-password': return 'Please choose a password with at least 8 characters.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials': return 'Email or password is incorrect.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a minute and try again.';
    case 'auth/network-request-failed': return 'No connection. Check your internet and try again.';
    case 'auth/user-disabled': return 'This account has been disabled. Contact support if you think this is a mistake.';
    default: return isSignUp ? 'We couldn\'t create your account. Please try again.' : 'We couldn\'t log you in. Please try again.';
  }
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

const AuthModal: React.FC<AuthModalProps> = ({ onClose, onSuccess, inline, initialIsSignUp = true, reason }) => {
  const [mode, setMode] = useState<'signup' | 'login' | 'reset'>(initialIsSignUp ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [tooYoung, setTooYoung] = useState(ageBlocked);
  const isSignUp = mode === 'signup';
  const thisYear = new Date().getFullYear();

  useEffect(() => { firstFieldRef.current?.focus(); }, [mode]);
  useEffect(() => {
    if (inline || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inline, onClose]);

  const passwordOk = password.length >= 8;
  const usernameOk = !username || /^[a-zA-Z0-9_.]{3,30}$/.test(username);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(''); setNotice('');
    if (mode === 'signup' && !passwordOk) { setError('Please choose a password with at least 8 characters.'); return; }
    if (mode === 'signup' && !usernameOk) { setError('Usernames are 3–30 letters, numbers, dots or underscores.'); return; }
    if (mode === 'signup') {
      if (ageBlocked()) { setTooYoung(true); return; }
      if (!birthMonth || !birthYear) { setError('Please tell us the month and year you were born.'); return; }
      if (ageFrom(Number(birthMonth), Number(birthYear)) < 13) {
        // Remember on this device for a day, so the answer can't simply be changed and resubmitted
        try { localStorage.setItem(AGE_BLOCK_KEY, String(Date.now() + 86_400_000)); } catch { /* storage unavailable */ }
        track('sign_up_age_blocked');
        setTooYoung(true);
        return;
      }
    }
    setLoading(true);
    try {
      if (mode === 'reset') {
        await FirebaseService.sendPasswordReset(email);
        setNotice('If an account exists for this email, a reset link is on its way.');
        setMode('login');
      } else if (mode === 'signup') {
        await FirebaseService.registerUser(email, password, username, { ageConfirmed: true });
        track('sign_up', { with_username: !!username });
        // The naturalist persona is offered later (after a few sightings), not straight after sign-up
        onSuccess();
      } else {
        await FirebaseService.loginUser(email, password);
        track('login');
        onSuccess();
      }
    } catch (err: any) {
      setError(friendlyError(err?.code || '', isSignUp));
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'signup' ? 'Join the field' : mode === 'login' ? 'Welcome back' : 'Reset your password';
  const subtitle = reason || (mode === 'signup'
    ? 'Keep a field journal, publish discoveries and follow other explorers.'
    : mode === 'login' ? 'Log in to continue your expeditions.' : 'We\'ll email you a link to choose a new password.');

  const inputClass = "w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3.5 text-base text-text-main placeholder:text-stone-400 focus:border-theme-accent focus:bg-white transition-colors";

  const content = (
    <div className={`w-full max-w-sm bg-white rounded-[2rem] p-7 ${inline ? '' : 'shadow-2xl relative overflow-hidden max-h-[90dvh] overflow-y-auto'}`}>
      {!inline && onClose && (
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100">
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      )}

      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-full bg-theme-accent/10 flex items-center justify-center mx-auto mb-3 text-theme-accent" aria-hidden="true">
          <span className="material-symbols-outlined text-3xl">{mode === 'reset' ? 'key' : 'eco'}</span>
        </div>
        <h2 id="auth-title" className="text-2xl font-display font-semibold text-text-main">{title}</h2>
        <p className="text-stone-600 text-sm mt-2 leading-relaxed">{subtitle}</p>
      </div>

      {mode === 'signup' && tooYoung ? (
        <div role="status" className="text-center space-y-3">
          <p className="font-display text-lg text-text-main">Thank you for wanting to join.</p>
          <p className="text-sm text-stone-600 leading-relaxed">NatureGram accounts are for explorers aged 13 and over, so we can't make one for you yet. You can still look at sightings shared by the community, and we'd love to welcome you when you're 13.</p>
          <p className="text-sm text-stone-600 leading-relaxed">Until then, a notebook and a pencil make a wonderful field journal. Ask a parent or teacher to explore with you.</p>
          {onClose && <button type="button" onClick={onClose} className="mt-2 w-full border border-stone-300 text-stone-800 font-semibold text-base py-3.5 rounded-xl hover:bg-stone-50">Back to exploring</button>}
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate={false}>
        {mode === 'signup' && (
          <div>
            <label htmlFor="auth-username" className="block text-sm font-semibold text-stone-700 mb-1.5">Username <span className="font-normal text-stone-500">(optional)</span></label>
            <input id="auth-username" ref={firstFieldRef} type="text" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="e.g. owl_watcher" className={inputClass} aria-invalid={!usernameOk} />
          </div>
        )}
        {mode === 'signup' && (
          <fieldset>
            <legend className="block text-sm font-semibold text-stone-700 mb-1.5">Month and year you were born</legend>
            <div className="flex gap-2">
              <label htmlFor="auth-birth-month" className="sr-only">Birth month</label>
              <select id="auth-birth-month" value={birthMonth} onChange={e => setBirthMonth(e.target.value)} required className={`${inputClass} flex-[3]`}>
                <option value="">Month</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <label htmlFor="auth-birth-year" className="sr-only">Birth year</label>
              <select id="auth-birth-year" value={birthYear} onChange={e => setBirthYear(e.target.value)} required className={`${inputClass} flex-[2]`}>
                <option value="">Year</option>
                {Array.from({ length: 100 }, (_, i) => thisYear - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <p className="text-xs mt-1.5 text-stone-500">Only used to check you're 13 or older. We don't keep it.</p>
          </fieldset>
        )}
        <div>
          <label htmlFor="auth-email" className="block text-sm font-semibold text-stone-700 mb-1.5">Email</label>
          <input id="auth-email" ref={mode === 'signup' ? undefined : firstFieldRef} type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" className={inputClass} />
        </div>
        {mode !== 'reset' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="auth-password" className="block text-sm font-semibold text-stone-700">Password</label>
              {mode === 'login' && (
                <button type="button" onClick={() => { setMode('reset'); setError(''); }} className="text-sm font-semibold text-theme-accent">Forgot password?</button>
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
              <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-stone-500">
                <span className="material-symbols-outlined" aria-hidden="true">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            {mode === 'signup' && (
              <p id="pw-hint" className={`text-xs mt-1.5 ${passwordOk ? 'text-emerald-700' : 'text-stone-500'}`}>
                {passwordOk ? '✓ ' : ''}At least 8 characters
              </p>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-red-700 text-sm bg-red-50 p-3 rounded-xl">{error}</p>}
        {notice && <p role="status" className="text-emerald-800 text-sm bg-emerald-50 p-3 rounded-xl">{notice}</p>}

        <button type="submit" disabled={loading} aria-busy={loading} className="w-full bg-theme-primary text-white font-bold text-base py-4 rounded-xl hover:bg-stone-800 transition-colors disabled:opacity-60 active:scale-[0.98]">
          {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : 'Send reset link'}
        </button>
      </form>
      )}

      <div className="mt-5 text-center text-sm text-stone-600">
        {mode === 'signup' ? (
          <>Already have an account? <button type="button" onClick={() => { setMode('login'); setError(''); }} className="font-bold text-theme-accent">Log in</button></>
        ) : (
          <>New to NatureGram? <button type="button" onClick={() => { setMode('signup'); setError(''); }} className="font-bold text-theme-accent">Create an account</button></>
        )}
      </div>
      {mode === 'signup' && (
        <p className="mt-4 text-xs text-stone-500 text-center leading-relaxed">
          By joining you agree to our <a href="/terms.html" target="_blank" rel="noopener" className="underline">Terms</a> and <a href="/privacy.html" target="_blank" rel="noopener" className="underline">Privacy Policy</a>, and confirm you are 13 or older.
        </p>
      )}
    </div>
  );

  if (inline) return content;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true"></div>
      <div className="relative z-10 w-full max-w-sm">{content}</div>
    </div>
  );
};

export default AuthModal;
