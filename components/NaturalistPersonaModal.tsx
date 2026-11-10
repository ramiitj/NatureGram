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
  { id: 'dawn-bird', title: 'A bird at dawn', line: 'The first song before the light', glyph: 'bird', bg: '', taxa: ['Birds & Avian Vocalizations'], styles: ['Bioacoustic Soundscapes'], habitats: ['Dense Canopy Forests'] },
  { id: 'mushroom', title: 'A mushroom after rain', line: 'Something new on the forest floor', glyph: 'mushroom', bg: '', taxa: ['Flora & Fungi'], styles: ['Macro Photography'], habitats: ['Dense Canopy Forests'] },
  { id: 'tide-pool', title: 'A tide pool', line: 'A whole world left by the sea', glyph: 'shell', bg: '', taxa: ['Marine & Aquatic Life'], styles: [], habitats: ['Coastal Tidepools & Reefs'] },
  { id: 'city-fox', title: 'A fox in the city', line: 'Wild lives between the houses', glyph: 'paw', bg: '', taxa: ['Mammal Ethology'], styles: ['Behavioral Motion Video'], habitats: ['Urban Wildlife Habitats'] },
  { id: 'bee', title: 'A bee on a flower', line: 'Small work, done carefully', glyph: 'insect', bg: '', taxa: ['Insects & Pollinators'], styles: ['Macro Photography'], habitats: [] },
  { id: 'night', title: 'Sounds in the night', line: 'Owls, frogs, a chorus in the dark', glyph: 'sound', bg: '', taxa: ['Amphibians & Reptiles'], styles: ['Bioacoustic Soundscapes'], habitats: ['Wetlands & Swamps'] },
  { id: 'trees', title: 'Trees and leaves', line: 'How a wood changes with the seasons', glyph: 'leaf', bg: '', taxa: ['Flora & Fungi'], styles: ['Field Journal Notes'], habitats: ['Dense Canopy Forests', 'Alpine & High Elevation'] },
  { id: 'insects-close', title: 'Insects up close', line: 'Wings, eyes and patterns', glyph: 'lens', bg: '', taxa: ['Insects & Pollinators'], styles: ['Macro Photography', 'Field Journal Notes'], habitats: [] },
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
    <div className="fixed inset-0 z-[160] flex items-end sm:items-center justify-center ng-scrim sm:p-5 font-body animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="persona-title">
      <div className="ng-sheet text-stone-900 w-full max-w-xl flex flex-col max-h-[92dvh] animate-slide-up">
        {state === 'saved' ? (
          <div className="p-10 text-center ng-rise" role="status">
            <Glyph name="feather" size={32} strokeWidth={1.3} className="text-stone-500 mx-auto" />
            <p className="ng-subtitle mt-5">Noted on your field page.</p>
            <span className="ng-rule mx-auto mt-6" aria-hidden="true" />
            <p className="ng-quote mt-5">“{extra.philosophy}”</p>
            <p className="ng-caption mt-3">{theme.naturalist}</p>
          </div>
        ) : (
          <>
            <header className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="persona-title" className="ng-title">What makes you stop and look?</h2>
                <p className="ng-small mt-2">Choose any that ring true. Your feed and your guide will lean towards them.</p>
              </div>
              <button onClick={onClose} aria-label="Close" className="ng-icon-button -mr-2 text-stone-500">
                <Glyph name="close" size={24} />
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
                        className={`relative w-full h-full text-left rounded-xl p-4 border transition-colors ${v.bg} ${on ? 'border-stone-900' : 'border-stone-200/90 hover:border-stone-300'}`}
                      >
                        <span className="block text-stone-500"><Glyph name={v.glyph} size={24} /></span>
                        <span className="block font-display italic text-[18px] leading-snug text-stone-900 mt-4">{v.title}</span>
                        <span className="block ng-caption mt-1">{v.line}</span>
                        {on && (
                          <span className="absolute top-3 right-3 text-theme-accent" aria-hidden="true">
                            <Glyph name="check" size={20} />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <label className="block mt-6">
                <span className="ng-label">Anything else you love to watch? <span className="text-stone-500">(optional)</span></span>
                <input
                  value={note}
                  onChange={e => setNote(e.target.value.slice(0, 200))}
                  placeholder="For example, herons on the canal"
                  className="mt-1 ng-field-line"
                />
              </label>
            </div>

            <footer className="px-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] border-t border-stone-200/80 flex items-center justify-between gap-4">
              <button type="button" onClick={onClose} className="ng-link-quiet min-h-[44px]">Not now</button>
              <button
                type="button"
                onClick={handleSave}
                disabled={state === 'saving' || (picked.length === 0 && !note.trim())}
                className="ng-button-primary"
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
