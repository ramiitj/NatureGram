import React, { useState } from 'react';
import Glyph from './Glyph';

/**
 * A one-time, one-line hint shown in place the first time a screen is opened.
 * Dismissed for good with ×; storage that is blocked simply means no hint.
 */
const keyOf = (id: string) => `ng_hint_${id}`;

const FirstHint: React.FC<{ id: string; text: string; className?: string }> = ({ id, text, className = '' }) => {
  const [show, setShow] = useState<boolean>(() => {
    try { return !localStorage.getItem(keyOf(id)); } catch { return false; }
  });
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(keyOf(id), '1'); } catch { /* storage blocked */ }
  };
  return (
    <div role="note" className={`mx-4 md:mx-12 mt-3 flex items-center gap-2 rounded-xl border border-[#e8dfcd] bg-[#fbf7ef] pl-3 pr-1 py-1 text-sm text-stone-700 ${className}`}>
      <Glyph name="guide" size={16} className="text-[rgb(var(--theme-accent-rgb))] shrink-0" />
      <span className="flex-1 min-w-0">{text}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss this hint" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-800 hover:bg-black/5">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
      </button>
    </div>
  );
};

export default FirstHint;
