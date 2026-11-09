import React from 'react';

interface Props { children: React.ReactNode; label?: string; onReset?: () => void; compact?: boolean }
interface State { error: Error | null }

/** Catches render errors so one broken view never blanks the whole app. */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
    try {
      window.dispatchEvent(new CustomEvent('ng:error', { detail: { message: error.message, label: this.props.label } }));
    } catch { /* noop */ }
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className={`flex flex-col items-center justify-center text-center p-8 gap-4 ${this.props.compact ? '' : 'min-h-[60vh]'}`}>
        <span className="material-symbols-outlined text-5xl text-theme-primary/60" aria-hidden="true">forest</span>
        <h2 className="text-xl font-display font-semibold text-stone-900">Something went off-trail</h2>
        <p className="text-base text-stone-600 max-w-sm">This part of NatureGram hit an unexpected problem. Your saved posts and drafts are safe.</p>
        <div className="flex gap-3">
          <button onClick={this.reset} className="px-6 py-3 rounded-full bg-stone-900 text-white font-bold text-sm">Try again</button>
          <button onClick={() => window.location.assign('/')} className="px-6 py-3 rounded-full bg-stone-100 text-stone-800 font-bold text-sm">Go home</button>
        </div>
      </div>
    );
  }
}
