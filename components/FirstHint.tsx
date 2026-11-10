import React, { useState } from 'react';
import Glyph from './Glyph';

/**
 * A one-time, one-line hint shown in place the first time a screen is opened.
 * Dismissed for good with ×; storage that is blocked simply means no hint.
 */
const keyOf = (id: string) => `ng_hint_${id}`;

const FirstHint: React.FC<{ id: string; text: string; className?: string; tone?: 'light' | 'dark' }> = ({ id, text, className = '', tone = 'light' }) => {
  const [show, setShow] = useState<boolean>(() => {
    try { return !localStorage.getItem(keyOf(id)); } catch { return false; }
  });
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(keyOf(id), '1'); } catch { /* storage blocked */ }
  };
  return (
    <div role="note" className={`mx-6 md:mx-12 mt-3 flex items-center gap-3 text-sm leading-[1.5] ${tone === 'dark' ? 'rounded-full bg-black/45 backdrop-blur-md pl-4 text-white/90' : 'text-stone-600'} ${className}`}>
      <span className={`block w-8 h-px shrink-0 ${tone === 'dark' ? 'bg-theme-vivid' : 'bg-theme-accent'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">{text}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss this hint" className={tone === 'dark' ? 'ng-icon-button-dark' : 'ng-icon-button text-stone-500'}>
        <Glyph name="close" size={20} />
      </button>
    </div>
  );
};

export default FirstHint;
