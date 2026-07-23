
import React, { useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { useI18n } from '../i18n/I18nContext';

interface AuthModalProps {
  onClose?: () => void;
  onSuccess: () => void;
  inline?: boolean;
  initialIsSignUp?: boolean;
}

const AuthModal: React.FC<AuthModalProps> = ({ onClose, onSuccess, inline, initialIsSignUp = true }) => {
  const { t } = useI18n();
  const [isSignUp, setIsSignUp] = useState(initialIsSignUp);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Password Indicators
  const hasMinLength = password.length >= 6;
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        await FirebaseService.registerUser(email, password);
      } else {
        await FirebaseService.loginUser(email, password);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const content = (
      <div className={`w-full max-w-sm bg-white rounded-[2.5rem] p-8 ${inline ? '' : 'shadow-2xl relative overflow-hidden'}`}>
        {!inline && onClose && (
          <button type="button" onClick={onClose} aria-label={t('authCloseLabel')} className="absolute top-6 right-6 text-stone-600 sm:hover:text-theme-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 rounded-full">
            <span className="material-symbols-outlined">close</span>
          </button>
        )}

        <div className="text-center mb-8">
           <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 text-primary">
              <span className="material-symbols-outlined text-3xl">lock</span>
           </div>
           <h2 className="text-2xl font-display font-black italic text-text-main">{isSignUp ? t('authJoinTitle') : t('authWelcomeBackTitle')}</h2>
           <p className="text-stone-600 text-xs mt-2">{t('authSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
           <div className="space-y-3">
              <input
                type="email"
                placeholder={t('authEmailPlaceholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-theme-primary/5 border border-theme-primary/20 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary transition-colors"
                required
              />
              <input
                type="password"
                placeholder={t('authPasswordPlaceholder')}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-theme-primary/5 border border-theme-primary/20 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary transition-colors"
                required
              />
           </div>

           {/* Password Indicators (Only on Sign Up) */}
           {isSignUp && (
             <div className="flex gap-2 mt-1">
                <div className={`h-1 flex-1 rounded-full transition-colors ${hasMinLength ? 'bg-accent' : 'bg-theme-primary/20'}`}></div>
                <div className={`h-1 flex-1 rounded-full transition-colors ${hasNumber ? 'bg-accent' : 'bg-theme-primary/20'}`}></div>
                <div className={`h-1 flex-1 rounded-full transition-colors ${hasSpecial ? 'bg-accent' : 'bg-theme-primary/20'}`}></div>
             </div>
           )}

           {/* Helper text for indicators */}
            {isSignUp && (
                <div className="flex justify-between text-[9px] text-stone-600 uppercase font-bold tracking-wider px-1">
                    <span className={hasMinLength ? 'text-accent' : ''}>{t('auth6Chars')}</span>
                    <span className={hasNumber ? 'text-accent' : ''}>{t('authNumber')}</span>
                    <span className={hasSpecial ? 'text-accent' : ''}>{t('authSymbol')}</span>
                </div>
            )}

           {error && <p className="text-red-500 text-xs text-center font-bold bg-red-50 py-2 rounded-lg">{error}</p>}

           <button
             type="submit"
             disabled={loading}
             onTouchEnd={(e) => {
               // Prevent synthetic click generation which causes double submit / tap issues
               e.preventDefault();
               handleSubmit(e as unknown as React.FormEvent);
             }}
             className="w-full py-4 bg-text-main text-white rounded-2xl font-bold shadow-xl shadow-theme-primary/40/20 mt-2 sm:hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-70"
           >
             {loading ? t('authProcessing') : (isSignUp ? t('authCreateAccount') : t('authSignIn'))}
           </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onTouchEnd={(e) => {
              e.preventDefault();
              setIsSignUp(!isSignUp);
            }}
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-xs text-stone-600 font-bold sm:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 rounded"
          >
            {isSignUp ? t('authToggleToSignIn') : t('authToggleToSignUp')}
          </button>
        </div>
      </div>
  );

  if (inline) {
      return content;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-fade-in font-body">
      {content}
    </div>
  );
};

export default AuthModal;
