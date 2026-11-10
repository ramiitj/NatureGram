import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Glyph from './Glyph';
import { track } from '../services/analytics.ts';

/**
 * A three-step welcome (Wild, the Lens, the challenge card), skippable at every step.
 * Each step spotlights a real element marked with data-tour="…" and puts a small card beside it;
 * a step whose element is not on screen shows a centred card. Everything else is taught in place,
 * once, by FirstHint.
 */

export const TOUR_KEY = 'naturegram_tour_v1';

export const hasSeenFirstRunTour = (): boolean => {
  try { return !!localStorage.getItem(TOUR_KEY); } catch { return true; } // storage blocked: never nag
};
export const resetFirstRunTour = () => {
  try { localStorage.removeItem(TOUR_KEY); } catch { /* storage blocked */ }
};
const remember = (how: 'done' | 'skipped') => {
  try { localStorage.setItem(TOUR_KEY, how); } catch { /* storage blocked */ }
};

type Step = { id: string; target: string; title: string; body: string };

/** Three steps, then the explorer finds the rest in place (see FirstHint). */
const STEPS: Step[] = [
  { id: 'wild', target: 'feed', title: 'Wild', body: 'What others are noticing outside today, from first buds to rare visitors.' },
  { id: 'lens', target: 'capture', title: 'The Lens', body: 'Your guide sees and hears with you. Point it at anything alive and put a name to it together.' },
  { id: 'challenge', target: 'challenge', title: 'The challenge card', body: 'A small invitation every fortnight, set by a great naturalist. It lives on this card.' },
];

const findTarget = (target: string): HTMLElement | null => {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`));
  return all.find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null;
};

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const GUTTER = 16;

interface FirstRunTourProps {
  /** Called once the tour is finished or skipped (the flag is already saved). */
  onClose: (how: 'done' | 'skipped') => void;
}

const FirstRunTour: React.FC<FirstRunTourProps> = ({ onClose }) => {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const scrolledFor = useRef<string>('');
  const closed = useRef(false);
  const reduced = useRef(prefersReducedMotion());

  // Let the feed settle. All three steps always show; a step whose element is off screen
  // gets a centred card instead of a spotlight.
  useEffect(() => {
    const t = setTimeout(() => setSteps(STEPS), 650);
    return () => clearTimeout(t);
  }, []);

  const step = steps?.[index];
  const total = steps?.length || 0;

  const close = useCallback((how: 'done' | 'skipped') => {
    if (closed.current) return;
    closed.current = true;
    remember(how);
    if (how === 'done') track('tour_done', { steps: total });
    else track('tour_skipped', { at: step?.id || '', index });
    onClose(how);
  }, [onClose, step, index, total]);

  const next = useCallback(() => {
    if (!steps) return;
    if (index < steps.length - 1) setIndex(i => i + 1); else close('done');
  }, [steps, index, close]);
  const back = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (step) track('tour_step', { step: step.id, index });
  }, [step, index]);

  // Measure the spotlighted element; recompute on resize, scroll and while things settle
  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    setVw(window.innerWidth);
    if (!el) { setRect(null); return; }
    let r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if ((r.top < 56 || r.bottom > vh - 88) && scrolledFor.current !== step.id) {
      scrolledFor.current = step.id;
      el.scrollIntoView({ block: 'center', behavior: reduced.current ? 'auto' : 'smooth' });
      r = el.getBoundingClientRect();
    }
    setRect(prev => (prev && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.left - r.left) < 0.5 && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5)
      ? prev : { top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    if (!step) return;
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    const poll = window.setInterval(measure, 250); // smooth scrolls, late images, font swaps
    return () => { window.removeEventListener('resize', onChange); window.removeEventListener('scroll', onChange, true); clearInterval(poll); };
  }, [step, measure]);

  // Place the card beside the spotlight: right of a side rail, otherwise below or above
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const w = card.offsetWidth, h = card.offsetHeight;
    const W = window.innerWidth, H = window.innerHeight;
    if (!rect) { setCardPos({ top: Math.max(GUTTER, (H - h) / 2), left: Math.max(GUTTER, (W - w) / 2) }); return; }
    const clampX = (x: number) => Math.min(Math.max(GUTTER, x), W - w - GUTTER);
    const clampY = (y: number) => Math.min(Math.max(GUTTER, y), H - h - GUTTER);
    const onRail = W >= 640 && rect.left + rect.width < Math.min(140, W * 0.25) && rect.height < H * 0.5;
    if (onRail) {
      setCardPos({ left: clampX(rect.left + rect.width + PAD + 18), top: clampY(rect.top + rect.height / 2 - h / 2) });
      return;
    }
    const below = H - (rect.top + rect.height + PAD);
    const top = below >= h + 28 ? rect.top + rect.height + PAD + 14 : rect.top - PAD - 14 - h;
    setCardPos({ left: clampX(rect.left + rect.width / 2 - w / 2), top: clampY(top) });
  }, [rect, index, vw, steps]);

  // Keyboard: Esc skips, arrows move, Tab stays inside the card
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close('skipped'); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); back(); return; }
      if (e.key === 'Tab' && cardRef.current) {
        const f = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !cardRef.current.contains(active)) { e.preventDefault(); first.focus(); return; }
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, next, back, close]);

  // Focus the main action each step, without jolting the page
  useEffect(() => {
    if (step) nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Nothing to show (no target found): bow out quietly and try again another time
  if (!steps || !steps.length || !step) return steps && !steps.length ? null : (
    <div className="fixed inset-0 z-[150]" aria-hidden="true" />
  );

  const isLast = index === total - 1;
  const round = rect && rect.width <= 72 && Math.abs(rect.width - rect.height) < 16;
  const motion = reduced.current ? '' : 'transition-all duration-500 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]';

  return (
    <div className="fixed inset-0 z-[150] font-body" role="dialog" aria-modal="true" aria-labelledby="first-tour-title" aria-describedby="first-tour-body">
      {/* Catches taps so the app below stays still during the tour */}
      <div className="absolute inset-0" onClick={e => e.stopPropagation()} aria-hidden="true" style={rect ? undefined : { background: 'rgb(28 25 23 / 0.62)' }} />

      {rect && (
        <div
          aria-hidden="true"
          className={`fixed pointer-events-none ${motion}`}
          style={{
            top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            borderRadius: round ? 9999 : 18,
            boxShadow: '0 0 0 2px rgb(255 255 255 / 0.9), 0 0 0 7px rgb(var(--theme-accent-rgb) / 0.35), 0 0 0 200vmax rgb(28 25 23 / 0.62)',
          }}
        />
      )}

      <div
        ref={cardRef}
        className={`fixed w-[min(340px,calc(100vw-32px))] ${motion}`}
        style={{ top: cardPos?.top ?? -9999, left: cardPos?.left ?? -9999, visibility: cardPos ? 'visible' : 'hidden' }}
      >
        <div className="bg-[#fcfaf8] rounded-2xl p-5 shadow-2xl border border-[#e8dfcd] relative overflow-hidden">
          <button onClick={() => close('skipped')} className="absolute top-2 right-2 min-h-[44px] px-3 text-sm font-semibold text-stone-600 hover:text-stone-900 transition-colors">
            Skip
          </button>
          <h2 id="first-tour-title" className="pr-14 flex items-center gap-2 text-xl font-display font-semibold text-stone-900 leading-snug"><Glyph name={step.id === 'wild' ? 'fern' : step.id === 'lens' ? 'lens' : 'compass'} size={20} className="text-theme-accent shrink-0" />{step.title}</h2>
          <p id="first-tour-body" className="text-stone-700 text-[15px] leading-relaxed mt-1.5">{step.body}</p>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{`Step ${index + 1} of ${total}. ${step.title}. ${step.body}`}</p>

          <div className="flex justify-between items-center mt-4 gap-2">
            <div className="flex items-center gap-1.5">
              {index > 0 && <button onClick={back} className="min-h-[44px] pr-3 -ml-1 text-sm font-semibold text-stone-600 hover:text-stone-900">Back</button>}
              <span className="flex items-center gap-1.5" aria-hidden="true">
                {steps.map((s, i) => (
                  <span key={s.id} className={`h-1.5 rounded-full ${reduced.current ? '' : 'transition-all duration-500'} ${i === index ? 'w-6 bg-theme-accent' : i < index ? 'w-1.5 bg-theme-accent/40' : 'w-1.5 bg-stone-300'}`} />
                ))}
              </span>
            </div>
            <button
              ref={nextRef}
              onClick={next}
              className="min-h-[44px] flex items-center gap-1.5 bg-stone-900 text-white pl-5 pr-4 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 active:scale-95 transition-transform shrink-0"
            >
              <span>{isLast ? 'Start exploring' : 'Next'}</span>
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{isLast ? 'check' : 'arrow_forward'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FirstRunTour;
