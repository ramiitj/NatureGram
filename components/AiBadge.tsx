import React from 'react';
import Glyph from './Glyph.tsx';

const FUNGI_RE = /(mushroom|fung|toadstool|amanita|bolete|chanterelle|morel|agaric|russula|lactarius|cortinarius|polypore|puffball|mycena|psilocybe|galerina|lepiota|coprinus|pleurotus|bracket)/i;

/** True when a post looks like it shows a fungus (drives the foraging safety warning). */
export const isFungiPost = (post: { labels?: string[]; tags?: string[]; aiInsight?: string | null } | null | undefined) =>
  !!post && (
    (post.labels || []).some(l => FUNGI_RE.test(l)) ||
    (post.tags || []).some(t => FUNGI_RE.test(t))
  );

export const FungiWarning: React.FC = () => (
  <div role="note" className="flex gap-3 py-3 pl-4 pr-4 rounded-r-lg bg-red-50/70 border-l-2 border-red-700 text-red-900">
    <Glyph name="alert" size={20} className="shrink-0 text-red-700 mt-0.5" />
    {/* glossary-ok: the physical specimen; the fungi warning is kept word for word */}
    <p className="text-sm leading-[1.6]"><strong className="font-semibold">Never eat or handle wild fungi based on this ID.</strong> Many deadly mushrooms look like edible ones. Only a qualified local expert examining the specimen can confirm edibility.</p>
  </div>
);

