import React from 'react';
import Glyph from './Glyph';
import { GROUP_GLYPH, GROUP_ORDER, LifeGroup } from '../services/lifeList';

/**
 * One row of chips for the kinds of life (the life list's groups), used by the feed and Explore.
 * Only kinds that are present are offered, so no choice ever leads to an empty page.
 */
const KindChips: React.FC<{
  present: Iterable<LifeGroup>;
  selected: LifeGroup | null;
  onSelect: (g: LifeGroup | null) => void;
  /** Offer an "All" chip that clears the choice */
  withAll?: boolean;
  counts?: Partial<Record<LifeGroup, number>>;
  label?: string;
  className?: string;
}> = ({ present, selected, onSelect, withAll = true, counts, label = 'Kinds of life', className = '' }) => {
  const have = new Set(present);
  const kinds = GROUP_ORDER.filter(g => have.has(g));
  if (!kinds.length) return null;
  const chip = (on: boolean) => `shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-sm transition-colors ${on ? 'bg-stone-900 border-stone-900 text-white' : 'border-stone-200 text-stone-700 hover:bg-stone-900/[0.03]'}`;
  return (
    <div role="group" aria-label={label} className={`w-full overflow-x-auto no-scrollbar flex items-center gap-1.5 py-1 -mx-4 px-4 ${className}`}>
      {withAll && (
        <button type="button" aria-pressed={selected === null} onClick={() => onSelect(null)} className={chip(selected === null)}>All</button>
      )}
      {kinds.map(g => {
        const on = selected === g;
        return (
          <button key={g} type="button" aria-pressed={on} onClick={() => onSelect(on && withAll ? null : g)} className={chip(on)}>
            <Glyph name={GROUP_GLYPH[g]} size={16} className={on ? 'text-white' : 'text-theme-accent'} />
            <span>{g}</span>
            {counts?.[g] !== undefined && <span className={`tabular-nums ${on ? 'text-white/80' : 'text-stone-500'}`}>{counts[g]}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default KindChips;
