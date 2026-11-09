import React, { useState } from 'react';

const FUNGI_RE = /(mushroom|fung|toadstool|amanita|bolete|chanterelle|morel|agaric|russula|lactarius|cortinarius|polypore|puffball|mycena|psilocybe|galerina|lepiota|coprinus|pleurotus|bracket)/i;

/** True when a post looks like it shows a fungus (drives the foraging safety warning). */
export const isFungiPost = (post: { labels?: string[]; tags?: string[]; aiInsight?: string | null } | null | undefined) =>
  !!post && (
    (post.labels || []).some(l => FUNGI_RE.test(l)) ||
    (post.tags || []).some(t => FUNGI_RE.test(t))
  );

/**
 * How sure the guide is, said the way a naturalist would say it rather than as a meter.
 * Low and medium confidence put the hedge into the name itself ("Possibly ...", "Likely ...").
 */
export const hedgedName = (name: string | undefined | null, confidence?: string | null, checked?: boolean): string => {
  const n = (name || '').trim();
  if (!n || checked) return n;
  if (confidence === 'low') return `Possibly ${n}`;
  if (confidence === 'medium') return `Likely ${n}`;
  return n;
};

/**
 * Transparent labelling for AI output (governance requirement), in the naturalist's voice:
 * every identification says it came from the guide (the app's AI naturalist), whether a person
 * checked it, and, on tap, what that means. Quiet by design; safety warnings stay loud elsewhere.
 */
const AiBadge: React.FC<{ confidence?: string | null; humanVerified?: boolean; compact?: boolean; tone?: 'light' | 'dark' }> = ({ confidence, humanVerified, compact, tone = 'light' }) => {
  const [open, setOpen] = useState(false);
  const dark = tone === 'dark';
  const ink = dark ? 'text-white/80' : 'text-stone-600';
  const sure = confidence === 'high' ? 'fairly sure' : confidence === 'medium' ? 'not certain' : confidence === 'low' ? 'unsure' : null;
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        aria-expanded={open}
        aria-label={`Identified by your guide, an AI naturalist${humanVerified ? ', checked by the explorer' : ''}${sure && !compact ? `, ${sure}` : ''}. Tap for details.`}
        className={`inline-flex items-center gap-1.5 text-[13px] min-h-[28px] ${ink} hover:underline decoration-dotted underline-offset-4`}
      >
        <span className="material-symbols-outlined text-[15px] not-italic" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">{humanVerified ? 'how_to_reg' : 'auto_awesome'}</span>
        {humanVerified ? 'Named by your guide, checked by the explorer' : 'Named by your guide'}
      </button>
      {open && (
        <p className={`text-xs leading-relaxed rounded-xl p-3 max-w-md ${dark ? 'bg-black/40 text-white/90' : 'bg-stone-50 text-stone-600'}`}>
          Your guide is NatureGram's AI naturalist. It named this from the photo, video or sound, and it can be wrong with partial views,
          look-alike species or poor light. {humanVerified ? 'The explorer reviewed it before posting. ' : ''}
          If you know better, say so: every correction makes the guide better for everyone.
        </p>
      )}
    </div>
  );
};

export const FungiWarning: React.FC = () => (
  <div role="note" className="flex gap-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-900">
    <span className="material-symbols-outlined shrink-0" aria-hidden="true">warning</span>
    <p className="text-sm leading-snug"><strong>Never eat or handle wild fungi based on this ID.</strong> Many deadly mushrooms look like edible ones. Only a qualified local expert examining the specimen can confirm edibility.</p>
  </div>
);

export default AiBadge;
