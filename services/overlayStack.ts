/**
 * One rule for every window, sheet and menu: the phone's back gesture, the browser's Back button,
 * Escape and the window's own × all close the window on top, and nothing else.
 *
 * Each open window takes one step in the browser history. Back pops that step and closes the
 * window instead of changing the page underneath. Closing it any other way (×, Escape, tapping
 * outside) removes its step quietly, so history never fills with dead entries.
 *
 * Page-level popstate listeners (App, Community) must ignore events this module has already
 * handled: `if (wasOverlayPop(e)) return;`.
 */
import { useEffect, useRef } from 'react';

type Entry = { id: number; close: () => void; escape: boolean };

const stack: Entry[] = [];
const handled = new WeakSet<Event>();
let nextId = 1;
/** Pops we caused ourselves (a window closed by × removes its history step) */
let selfPops = 0;

const isBrowser = typeof window !== 'undefined';

if (isBrowser) {
  // Registered when this module first loads, so it runs before any page-level listener
  window.addEventListener('popstate', (e) => {
    if (selfPops > 0) { selfPops--; handled.add(e); return; }
    const top = stack.pop();
    if (top) { handled.add(e); try { top.close(); } catch { /* ignore */ } }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const top = stack[stack.length - 1];
    if (!top || !top.escape) return;
    e.preventDefault();
    e.stopPropagation();
    closeEntry(top);
  }, true);
}

/** True when the popstate event closed a window, so the page underneath must not change. */
export const wasOverlayPop = (e: Event) => handled.has(e);

/** True while any window is open (e.g. to keep page-level shortcuts quiet). */
export const overlayOpen = () => stack.length > 0;

/**
 * Remove a window's history step, but only if nothing new was pushed meanwhile: a window that
 * closes because the explorer went somewhere (a notification opening a post) must not undo that.
 * A step left behind is harmless: going back to it simply shows the page it belonged to.
 */
function dropStep(id: number) {
  if (!isBrowser) return;
  setTimeout(() => {
    if (window.history.state?.ngOverlay === id) { selfPops++; window.history.back(); }
  }, 0);
}

function closeEntry(entry: Entry) {
  const i = stack.indexOf(entry);
  if (i === -1) return;
  stack.splice(i, 1);
  try { entry.close(); } catch { /* ignore */ }
  dropStep(entry.id);
}

/**
 * While `open` is true, the window belongs to the stack: Back and Escape call `onClose`.
 * Call the returned `close()` from the window's own × / Cancel / outside tap instead of setting
 * state directly, so the history step is removed too (calling onClose directly also works; the
 * step is then cleaned up when `open` turns false).
 */
export function useBackToClose(open: boolean, onClose: () => void, opts: { escape?: boolean } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const entryRef = useRef<Entry | null>(null);

  useEffect(() => {
    if (!open || !isBrowser) return;
    const entry: Entry = { id: nextId++, close: () => closeRef.current(), escape: opts.escape !== false };
    entryRef.current = entry;
    stack.push(entry);
    try {
      window.history.pushState({ ...(window.history.state || {}), ngOverlay: entry.id }, '', window.location.href);
    } catch { /* history unavailable */ }
    return () => {
      // Closed by the page (state changed) rather than by Back: drop the step quietly
      const i = stack.indexOf(entry);
      if (i !== -1) { stack.splice(i, 1); dropStep(entry.id); }
      entryRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { close: () => { const e = entryRef.current; if (e) closeEntry(e); else closeRef.current(); } };
}
