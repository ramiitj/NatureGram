import React from 'react';
import Glyph from './Glyph';

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
        <Glyph name="signpost" size={40} strokeWidth={1.2} className="text-stone-400" />
        <h2 className="ng-title italic">Something went off-trail</h2>
        {/* glossary-ok: the error boundary copy is kept as it is (shared brief) */}
        <p className="ng-body text-stone-600 max-w-sm">This part of NatureGram hit an unexpected problem. Your saved posts and drafts are safe.</p>
        <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-3 mt-4">
          <button onClick={this.reset} className="ng-button-primary">Try again</button>
          <button onClick={() => window.location.assign('/')} className="ng-link-quiet min-h-[44px]">Go home</button>
        </div>
      </div>
    );
  }
}
