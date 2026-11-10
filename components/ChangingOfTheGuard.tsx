import React, { useEffect, useState } from 'react';
import Glyph from './Glyph';
import { NATURALIST_THEMES } from '../constants/naturalists';
import { getNaturalistExtra } from '../constants/naturalistExtras';
import { FirebaseService } from '../services/firebaseService';

const SEEN_KEY = 'naturegram_last_naturalist';

const readSeen = (): string | null => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (id: string) => { try { localStorage.setItem(SEEN_KEY, id); } catch { /* storage blocked */ } };

/**
 * Which naturalist handed over since the explorer's last visit, if any.
 * The very first visit only records the current naturalist (nothing to hand over yet).
 */
export const pendingHandover = (currentId?: string): string | null => {
  if (!currentId) return null;
  const seen = readSeen();
  if (!seen) { writeSeen(currentId); return null; }
  if (seen === currentId || !NATURALIST_THEMES.some(t => t.id === seen)) { if (seen !== currentId) writeSeen(currentId); return null; }
  return seen;
};

interface Props {
  previousId: string;
  current: { id?: string; naturalist: string; quote?: string };
  onOpenNaturalist: () => void;
  onDone: () => void;
}

/**
 * The changing of the guard: shown once, on the first open after the fortnight's naturalist rotates.
 * "{previous} hands the notebook to {current}", a short recap of the fortnight just ended, and a way in
 * to the new naturalist's page.
 */
const ChangingOfTheGuard: React.FC<Props> = ({ previousId, current, onOpenNaturalist, onDone }) => {
  const prev = NATURALIST_THEMES.find(t => t.id === previousId);
  const prevExtra = getNaturalistExtra(previousId);
  const [answered, setAnswered] = useState<{ explorers: number; capped: boolean } | null>(null);

  // Shown once: remember the new naturalist the moment the card appears
  useEffect(() => { if (current.id) writeSeen(current.id); }, [current.id]);
  useEffect(() => {
    let alive = true;
    FirebaseService.getChallengeProgress(prevExtra.challengeTag).then(r => { if (alive) setAnswered(r); }).catch(() => {});
    return () => { alive = false; };
  }, [prevExtra.challengeTag]);

  if (!prev) return null;
  const prevLast = prev.naturalist.split(' ').slice(-1)[0];

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="guard-title">
      <div className="absolute inset-0 ng-scrim" onClick={onDone} aria-hidden="true" />
      <section className="relative w-full max-w-sm bg-day-bg rounded-2xl shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)] ng-rise mb-[env(safe-area-inset-bottom)]">
        <div className="p-7">
          <p className="ng-kicker">Naturalist of the fortnight</p>
          <h2 id="guard-title" className="ng-title mt-4">
            {prev.naturalist} hands the notebook to {current.naturalist}
          </h2>
          <p className="ng-small text-[15px] text-stone-700 mt-4">
            {answered && answered.explorers > 0
              ? `Last fortnight, ${answered.capped ? 'more than 60' : answered.explorers} explorer${answered.explorers === 1 ? '' : 's'} answered ${prevLast}'s challenge: ${prevExtra.challenge.replace(/\.$/, '').toLowerCase()}.`
              : <>Last fortnight’s words to keep: <span className="font-display italic">“{prev.quote}”</span></>}
          </p>
          <div className="mt-8 flex items-center gap-6">
            <button onClick={() => { onDone(); onOpenNaturalist(); }} autoFocus className="ng-button-primary group">
              Meet {current.naturalist.split(' ').slice(-1)[0]}<Glyph name="forward" size={20} className="ng-arrow transition-transform group-hover:translate-x-0.5" />
            </button>
            <button onClick={onDone} className="ng-link-quiet min-h-[44px]">Later</button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ChangingOfTheGuard;
