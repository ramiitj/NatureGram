import React from 'react';

/**
 * Loading states drawn like a plant press rather than grey blocks: a cream plate with a leaf
 * outline slowly drawing itself in, as if the specimen were being pressed onto the sheet.
 * Under reduced motion the leaf is simply shown, still and faint.
 */
const PRESS_CSS = `
@keyframes ngLeafDraw { 0% { stroke-dashoffset: 1; opacity: .35 } 55% { stroke-dashoffset: 0; opacity: 1 } 100% { stroke-dashoffset: 0; opacity: .35 } }
@keyframes ngPaperBreath { 0%, 100% { opacity: .55 } 50% { opacity: .9 } }
.ng-leaf-draw path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: ngLeafDraw 2.8s ease-in-out infinite; }
.ng-leaf-draw path + path { animation-delay: .35s; }
.ng-paper-breath { animation: ngPaperBreath 2.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .ng-leaf-draw path { animation: none; stroke-dashoffset: 0; opacity: .6; }
  .ng-paper-breath { animation: none; opacity: .7; }
}`;

let cssInjected = false;
const PressStyles: React.FC = () => {
  // Inject once per page; harmless if several loaders mount together
  if (typeof document !== 'undefined' && !cssInjected) {
    cssInjected = true;
    const el = document.createElement('style');
    el.setAttribute('data-ng', 'press');
    el.textContent = PRESS_CSS;
    document.head.appendChild(el);
  }
  return null;
};

/** A leaf outline that draws itself in. Inherits currentColor. */
export const PressLeaf: React.FC<{ size?: number; className?: string }> = ({ size = 40, className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" className={`ng-leaf-draw ${className}`} aria-hidden="true">
    <path pathLength={1} d="M5 19C5 10 11 5 20 4c0 9-5 15-14 15z" />
    <path pathLength={1} d="M5 19l9-9M10 14.2l-.6-3M13 11.3l2.8.4" />
  </svg>
);

/** A small, reusable "pressing" loader for anywhere a spinner would go. */
export const PressingLoader: React.FC<{ label?: string; size?: number; className?: string }> = ({ label, size = 36, className = '' }) => (
  <div role="status" className={`flex flex-col items-center justify-center gap-2 text-[#a8957a] ${className}`}>
    <PressStyles />
    <PressLeaf size={size} />
    {label ? <span className="text-sm font-display italic text-stone-500">{label}</span> : <span className="sr-only">Loading</span>}
  </div>
);

/** Placeholder for a feed card while sightings load: a cream specimen plate being pressed. */
const SkeletonPost: React.FC<{ tall?: boolean }> = ({ tall }) => (
  <div className="relative break-inside-avoid" aria-hidden="true">
    <PressStyles />
    <div className="rounded-[3px] p-2 bg-[#fbf7ef] shadow-[0_1px_2px_rgba(60,40,20,0.10)]">
      <div className="rounded-[2px] border border-[#e3d8c4] p-2">
        <div className={`ng-paper-breath bg-[#f1e9d9] ${tall ? 'aspect-[3/4]' : 'aspect-[4/5]'} w-full flex items-center justify-center text-[#c2b08f]`}>
          <PressLeaf size={34} />
        </div>
        <div className="ng-paper-breath h-2.5 bg-[#eee4d1] rounded-full w-3/4 mt-2.5" />
        <div className="ng-paper-breath h-2 bg-[#f1e9d9] rounded-full w-1/2 mt-1.5" />
      </div>
    </div>
  </div>
);

export default SkeletonPost;
