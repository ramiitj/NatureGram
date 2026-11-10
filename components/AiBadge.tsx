import React from 'react';

const FUNGI_RE = /(mushroom|fung|toadstool|amanita|bolete|chanterelle|morel|agaric|russula|lactarius|cortinarius|polypore|puffball|mycena|psilocybe|galerina|lepiota|coprinus|pleurotus|bracket)/i;

/** True when a post looks like it shows a fungus (drives the foraging safety warning). */
export const isFungiPost = (post: { labels?: string[]; tags?: string[]; aiInsight?: string | null } | null | undefined) =>
  !!post && (
    (post.labels || []).some(l => FUNGI_RE.test(l)) ||
    (post.tags || []).some(t => FUNGI_RE.test(t))
  );

export const FungiWarning: React.FC = () => (
  <div role="note" className="flex gap-3 p-3.5 rounded-r-xl rounded-l-[3px] bg-red-50 border border-red-200 border-l-4 border-l-red-700 text-red-900">
    <span className="material-symbols-outlined shrink-0 text-red-700" aria-hidden="true">warning</span>
    {/* glossary-ok: the physical specimen; the fungi warning is kept word for word */}
    <p className="text-sm leading-snug"><strong>Never eat or handle wild fungi based on this ID.</strong> Many deadly mushrooms look like edible ones. Only a qualified local expert examining the specimen can confirm edibility.</p>
  </div>
);

