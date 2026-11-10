import React, { useEffect, useState } from 'react';
import { NaturalistPersona } from '../types';
import { FirebaseService } from '../services/firebaseService';
import Glyph, { GlyphName } from './Glyph';
import { getDailyTheme } from '../constants/naturalists';
import { getNaturalistExtra } from '../constants/naturalistExtras';

interface NaturalistPersonaModalProps {
  userId?: string;
  initialPersona?: NaturalistPersona | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (persona: NaturalistPersona) => void;
  /** Kept for compatibility; the modal is always skippable ("Not now"). */
  showSkipOption?: boolean;
}

/**
 * Each vignette maps onto the persona values the feed ranking (services/ranking.ts) and the AI curator
 * (genAiService.curateAgenticFeed) already understand, so the saved shape is unchanged:
 * taxaInterests / observationStyles / habitatAffinities use the same strings as before.
 */
interface Vignette { id: string; title: string; line: string; glyph: GlyphName; bg: string; taxa: string[]; styles: string[]; habitats: string[] }

const VIGNETTES: Vignette[] = [
  { id: 'dawn-bird', title: 'A bird at dawn', line: 'The first song before the light', glyph: 'bird', bg: 'from-theme-accent/15 to-stone-50', taxa: ['Birds & Avian Vocalizations'], styles: ['Bioacoustic Soundscapes'], habitats: ['Dense Canopy Forests'] },
  { id: 'mushroom', title: 'A mushroom after rain', line: 'Something new on the forest floor', glyph: 'mushroom', bg: 'from-stone-200/70 to-stone-50', taxa: ['Flora & Fungi'], styles: ['Macro Photography'], habitats: ['Dense Canopy Forests'] },
  { id: 'tide-pool', title: 'A tide pool', line: 'A whole world left by the sea', glyph: 'shell', bg: 'from-theme-primary/10 to-stone-50', taxa: ['Marine & Aquatic Life'], styles: [], habitats: ['Coastal Tidepools & Reefs'] },
  { id: 'city-fox', title: 'A fox in the city', line: 'Wild lives between the houses', glyph: 'paw', bg: 'from-theme-accent/10 to-stone-100', taxa: ['Mammal Ethology'], styles: ['Behavioral Motion Video'], habitats: ['Urban Wildlife Habitats'] },
  { id: 'bee', title: 'A bee on a flower', line: 'Small work, done carefully', glyph: 'insect', bg: 'from-theme-vivid/10 to-stone-50', taxa: ['Insects & Pollinators'], styles: ['Macro Photography'], habitats: [] },
  { id: 'night', title: 'Sounds in the night', line: 'Owls, frogs, a chorus in the dark', glyph: 'sound', bg: 'from-stone-300/70 to-stone-100', taxa: ['Amphibians & Reptiles'], styles: ['Bioacoustic Soundscapes'], habitats: ['Wetlands & Swamps'] },
  { id: 'trees', title: 'Trees and leaves', line: 'How a wood changes with the seasons', glyph: 'leaf', bg: 'from-theme-primary/15 to-stone-50', taxa: ['Flora & Fungi'], styles: ['Field Journal Notes'], habitats: ['Dense Canopy Forests', 'Alpine & High Elevation'] },
  { id: 'insects-close', title: 'Insects up close', line: 'Wings, eyes and patterns', glyph: 'lens', bg: 'from-stone-100 to-theme-accent/10', taxa: ['Insects & Pollinators'], styles: ['Macro Photography', 'Field Journal Notes'], habitats: [] },
];

const uniq = (xs: string[]) => Array.from(new Set(xs));

/** Vignettes that match a persona saved earlier (old or new modal), so reopening shows what was chosen. */
const picksFrom = (p?: NaturalistPersona | null): string[] => {
  if (!p) return [];
  const taxa = new Set(p.taxaInterests || []);
  const habitats = new Set(p.habitatAffinities || []);
  const styles = new Set(p.observationStyles || []);
  return VIGNETTES.filter(v => v.taxa.every(t => taxa.has(t))
    && (v.habitats.length === 0 || v.habitats.some(h => habitats.has(h)))
    && (v.styles.length === 0 || v.styles.some(s => styles.has(s)))).map(v => v.id);
};

/** A plain line in place of the old archetype titles; shown on the profile and given to the curator. */
const archetypeFor = (picked: Vignette[]) => {
  if (!picked.length) return 'Explorer';
  const names = picked.map(v => v.title.charAt(0).toLowerCase() + v.title.slice(1));
  const line = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and more`;
  return `Stops for ${line}`.slice(0, 80);
};

/** "What makes you stop and look?": a few illustrated moments, any number of them, all optional. */
export const NaturalistPersonaModal: React.FC<NaturalistPersonaModalProps> = ({ userId, initialPersona, isOpen, onClose, onSave }) => {
  const [picked, setPicked] = useState<string[]>(() => picksFrom(initialPersona));
  const [note, setNote] = useState<string>(initialPersona?.customFocus || '');
  const [state, setState] = useState<'choosing' | 'saving' | 'saved'>('choosing');
  const theme = getDailyTheme();
  const extra = getNaturalistExtra(theme.id);

  useEffect(() => { if (isOpen) { setPicked(picksFrom(initialPersona)); setNote(initialPersona?.customFocus || ''); setState('choosing'); } }, [isOpen, initialPersona]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state === 'choosing') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, state, onClose]);

  if (!isOpen) return null;

  const toggle = (id: string) => setPicked(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const handleSave = async () => {
    setState('saving');
    const chosen = VIGNETTES.filter(v => picked.includes(v.id));
    const persona: NaturalistPersona = {
      archetype: archetypeFor(chosen),
      taxaInterests: uniq(chosen.flatMap(v => v.taxa)),
      observationStyles: uniq(chosen.flatMap(v => v.styles)),
      habitatAffinities: uniq(chosen.flatMap(v => v.habitats)),
      customFocus: note.trim(),
    };
    if (initialPersona?.curatorPrompt) persona.curatorPrompt = initialPersona.curatorPrompt;
    try {
      if (userId && userId !== 'explorer_guest') await FirebaseService.updateNaturalistPersona(userId, persona);
    } catch { /* saved quietly; the feed simply stays unpersonalised */ }
    setState('saved');
    window.setTimeout(() => onSave(persona), 1900); // the parent closes the modal on save
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-end sm:items-center justify-center bg-stone-900/60 backdrop-blur-sm sm:p-5 font-body animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="persona-title">
      <div className="bg-day-bg text-stone-900 rounded-t-[2rem] sm:rounded-[2rem] w-full max-w-xl shadow-2xl flex flex-col max-h-[92dvh] animate-slide-up">
        {state === 'saved' ? (
          <div className="p-8 text-center" role="status">
            <Glyph name="feather" size={34} className="text-theme-accent mx-auto" />
            <p className="font-display text-xl text-stone-900 mt-4">Noted in your field notebook.</p>
            <p className="font-display italic text-lg text-theme-primary mt-4 leading-snug">“{extra.philosophy}”</p>
            <p className="text-sm text-stone-500 mt-2">{theme.naturalist}</p>
          </div>
        ) : (
          <>
            <header className="px-6 pt-6 pb-3 flex items-start justify-between gap-3">
              <div>
                <h2 id="persona-title" className="text-2xl font-display font-semibold text-stone-900">What makes you stop and look?</h2>
                <p className="text-sm text-stone-600 mt-1">Choose any that ring true. Your feed and your guide will lean towards them.</p>
              </div>
              <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 rounded-full hover:bg-stone-100 flex items-center justify-center text-stone-500 shrink-0">
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </header>

            <div className="overflow-y-auto px-6 pb-4 flex-1">
              <ul className="grid grid-cols-2 gap-3" role="list">
                {VIGNETTES.map(v => {
                  const on = picked.includes(v.id);
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => toggle(v.id)}
                        aria-pressed={on}
                        className={`relative w-full h-full text-left rounded-2xl p-3.5 border transition-all active:scale-[0.98] bg-gradient-to-br ${v.bg} ${on ? 'border-theme-accent ring-2 ring-theme-accent/40' : 'border-stone-200 hover:border-theme-primary/30'}`}
                      >
                        <span className={`block ${on ? 'text-theme-accent' : 'text-theme-primary/80'}`}><Glyph name={v.glyph} size={36} strokeWidth={1.3} /></span>
                        <span className="block font-display text-[17px] leading-tight text-stone-900 mt-3">{v.title}</span>
                        <span className="block text-xs text-stone-600 mt-1 leading-snug">{v.line}</span>
                        {on && (
                          <span className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-theme-accent text-white flex items-center justify-center" aria-hidden="true">
                            <span className="material-symbols-outlined text-[16px]">check</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <label className="block mt-5">
                <span className="text-sm text-stone-700">Anything else you love to watch? <span className="text-stone-500">(optional)</span></span>
                <input
                  value={note}
                  onChange={e => setNote(e.target.value.slice(0, 200))}
                  placeholder="For example, herons on the canal"
                  className="mt-1.5 w-full bg-white border border-stone-200 rounded-xl px-4 py-3 text-base placeholder:text-stone-400 focus:border-theme-accent"
                />
              </label>
            </div>

            <footer className="px-6 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] border-t border-stone-100 flex items-center justify-between gap-3">
              <button type="button" onClick={onClose} className="px-3 py-3 text-sm font-semibold text-stone-600 hover:text-stone-900">Not now</button>
              <button
                type="button"
                onClick={handleSave}
                disabled={state === 'saving' || (picked.length === 0 && !note.trim())}
                className="px-6 py-3 rounded-full text-sm font-semibold bg-theme-primary text-white disabled:opacity-40"
              >
                {state === 'saving' ? 'Noting it down…' : 'Keep these'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};

export default NaturalistPersonaModal;
