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
      <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={onDone} aria-hidden="true" />
      <section className="relative w-full max-w-sm bg-[#fbf7ef] rounded-[3px] p-2 shadow-2xl animate-slide-up mb-[env(safe-area-inset-bottom)]">
        <div className="border border-[#d8ccb6] outline outline-1 outline-offset-[3px] outline-[#e8dfcd] rounded-[2px] p-6">
          <Glyph name="notebook" size={34} className="text-theme-accent" />
          <h2 id="guard-title" className="font-display text-2xl font-semibold text-stone-900 leading-snug mt-3">
            {prev.naturalist} hands the notebook to {current.naturalist}
          </h2>
          <p className="text-[15px] text-stone-700 leading-relaxed mt-3">
            {answered && answered.explorers > 0
              ? `Last fortnight, ${answered.capped ? 'more than 60' : answered.explorers} explorer${answered.explorers === 1 ? '' : 's'} answered ${prevLast}'s challenge: ${prevExtra.challenge.replace(/\.$/, '').toLowerCase()}.`
              : <>Last fortnight’s words to keep: <span className="font-display italic">“{prev.quote}”</span></>}
          </p>
          <div className="mt-6 flex items-center gap-2">
            <button onClick={() => { onDone(); onOpenNaturalist(); }} autoFocus className="flex-1 px-5 py-3 rounded-full bg-stone-900 text-white text-sm font-semibold">
              Meet {current.naturalist.split(' ').slice(-1)[0]}
            </button>
            <button onClick={onDone} className="px-4 py-3 text-sm font-semibold text-stone-600 hover:text-stone-900">Later</button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ChangingOfTheGuard;
