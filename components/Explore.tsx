import React, { useEffect, useMemo, useState } from 'react';
import Glyph from './Glyph';
import SpecimenPlate, { PlateStamp } from './SpecimenPlate';
import SearchPanel, { plateOfPost, placeOf } from './SearchPanel';
import KindChips from './KindChips';
import { FirebaseService } from '../services/firebaseService';
import { groupOf, GROUP_ORDER, LifeGroup } from '../services/lifeList';
import { getNaturalistExtra, getThemePeriod } from '../constants/naturalistExtras';
import { CommunityPost } from '../types';
import FirstHint from './FirstHint';

/**
 * Explore: the community's collection laid out like a naturalist's cabinet rather than a feed.
 *  - The one search (components/SearchPanel.tsx, shared with the feed)
 *  - Kinds of life: the life list's groups, the first one open
 *  - Places: where recent sightings were made
 *  - Recently confirmed: sightings at least two explorers have agreed on
 * The fortnight's challenge lives on the feed card and the naturalist's page; Explore links to it.
 * Everything is built from existing public queries; nothing new is stored.
 */
export interface ExploreProps {
  onOpenPost: (postId: string, post?: CommunityPost) => void;
  onOpenProfile: (userId: string) => void;
  /** Kept for callers; the bottom navigation is always there on Explore, so it shows no back arrow */
  onBack?: () => void;
  /** Opens the naturalist of the fortnight (the challenge) */
  onOpenNaturalist?: () => void;
}

const Shelf: React.FC<{ posts: CommunityPost[]; onOpenPost: ExploreProps['onOpenPost']; stamp?: (p: CommunityPost) => React.ReactNode; empty?: string }> = ({ posts, onOpenPost, stamp, empty }) => (
  posts.length === 0
    ? <p className="font-display italic text-base text-stone-500">{empty || 'Nothing here yet.'}</p>
    : (
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {posts.map(p => (
          <li key={p.id}>
            <SpecimenPlate data={plateOfPost(p)} size="sm" stamp={stamp?.(p)} onClick={() => onOpenPost(p.id, p)} />
          </li>
        ))}
      </ul>
    )
);

/** A section opens as the landing does: the fortnight's fine rule, then the title in serif. */
const SectionHead: React.FC<{ glyph: React.ComponentProps<typeof Glyph>['name']; title: string; note?: string; id: string }> = ({ glyph, title, note, id }) => (
  <div className="mb-6">
    <h2 id={id} className="ng-subtitle flex items-center gap-3"><span className="ng-rule" aria-hidden="true" />{title}<Glyph name={glyph} size={20} className="text-stone-400" /></h2>
    {note && <p className="ng-small mt-1 pl-11">{note}</p>}
  </div>
);

const Explore: React.FC<ExploreProps> = ({ onOpenPost, onOpenProfile, onOpenNaturalist }) => {
  const period = useMemo(() => getThemePeriod(), []);
  const extra = getNaturalistExtra(period.theme.id);
  const [recent, setRecent] = useState<CommunityPost[] | null>(null);
  const [confirmed, setConfirmed] = useState<CommunityPost[] | null>(null);
  const [group, setGroup] = useState<LifeGroup | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  // A search arriving from a search engine or a field-guide page: /explore?q=barn+owl
  const [q, setQ] = useState(() => (window.location.pathname.startsWith('/explore') ? (new URLSearchParams(window.location.search).get('q') || '').slice(0, 80) : ''));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    FirebaseService.getRecentPublic(90).then(p => { if (alive) setRecent(p); }).catch(() => { if (alive) { setRecent([]); setFailed(true); } });
    FirebaseService.getRecentlyConfirmed(8).then(p => { if (alive) setConfirmed(p); }).catch(() => { if (alive) setConfirmed([]); });
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => {
    const m = new Map<LifeGroup, CommunityPost[]>();
    (recent || []).forEach(p => { const g = groupOf(p); m.set(g, [...(m.get(g) || []), p]); });
    return GROUP_ORDER.filter(g => m.has(g)).map(g => ({ group: g, posts: m.get(g)! }));
  }, [recent]);
  // The first kind is open from the start, so there is always something to look at
  const shownGroup = group && groups.some(x => x.group === group) ? group : (groups[0]?.group || null);

  const places = useMemo(() => {
    const m = new Map<string, CommunityPost[]>();
    (recent || []).forEach(p => {
      const name = placeOf(p);
      if (name) m.set(name, [...(m.get(name) || []), p]);
    });
    return [...m.entries()].map(([name, posts]) => ({ name, posts, kinds: new Set(posts.map(p => (p.labels?.[0] || '').toLowerCase()).filter(Boolean)).size }))
      .sort((a, b) => b.posts.length - a.posts.length).slice(0, 12);
  }, [recent]);

  /** A few species explorers have recorded lately, to offer before anything is typed */
  const suggestions = useMemo(() => {
    const seen = new Map<string, number>();
    (recent || []).forEach(p => { const l = String(p.labels?.[0] || '').trim(); if (l && !/^(unknown|nature|unidentified|captured|uploaded)/i.test(l)) seen.set(l, (seen.get(l) || 0) + 1); });
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
  }, [recent]);

  const loading = <p className="ng-small text-stone-500" aria-live="polite">Gathering sightings…</p>;
  const searching = q.trim().length > 0;

  return (
    <div className="min-h-screen shrink-0 w-full bg-day-bg text-text-main pb-24">
      <header className="safe-pt">
        <div className="max-w-6xl mx-auto ng-page pt-6 md:pt-8">
          <h1 className="ng-title">Explore</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto ng-page pt-6 space-y-12 md:space-y-16 ng-rise">
        <FirstHint id="explore" text="Wander by place, by kind of life, or by season." className="!mx-0" />
        <section aria-label="Search">
          <SearchPanel
            inputId="explore-search"
            query={q}
            onQueryChange={setQ}
            open={searching}
            onOpenPost={(p) => onOpenPost(p.id, p)}
            onOpenProfile={onOpenProfile}
            suggestions={suggestions}
          />
          {!searching && onOpenNaturalist && (
            <button type="button" onClick={onOpenNaturalist} className="group mt-4 w-full text-left flex items-center gap-3 text-sm text-stone-600 hover:text-stone-900 min-h-[44px]">
              <span className="ng-rule shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{period.theme.naturalist.split(' ').slice(-1)[0]}'s challenge: <span className="font-display italic text-base text-stone-900">{extra.challenge}</span></span>
              <Glyph name="forward" size={20} className="text-theme-accent shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          )}
        </section>

        {!searching && (<>
          {failed && <p role="status" className="ng-small">The collection didn't load. Check your connection and try again.</p>}

          {/* Kinds of life */}
          <section aria-labelledby="explore-kinds">
            <SectionHead id="explore-kinds" glyph="press" title="Kinds of life" />
            {recent === null ? loading : groups.length === 0 ? <p className="font-display italic text-base text-stone-500">No sightings yet.</p> : (<>
              <KindChips
                present={groups.map(g => g.group)}
                selected={shownGroup}
                onSelect={(g) => { if (g) setGroup(g); }}
                withAll={false}
                counts={Object.fromEntries(groups.map(g => [g.group, g.posts.length]))}
              />
              <div className="mt-6">
                <Shelf posts={groups.find(x => x.group === shownGroup)?.posts.slice(0, 12) || []} onOpenPost={onOpenPost} />
              </div>
            </>)}
          </section>

          {/* Places */}
          <section aria-labelledby="explore-places">
            <SectionHead id="explore-places" glyph="tracks" title="Places" />
            {recent === null ? loading : places.length === 0 ? <p className="font-display italic text-base text-stone-500">No shared places yet.</p> : (<>
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-x-8 border-t border-stone-200/80">
                {places.map(pl => {
                  const on = place === pl.name;
                  const thumb = (pl.posts[0] as any).thumbSmallUrl || pl.posts[0].thumbnailUrl;
                  return (
                    <li key={pl.name} className="border-b border-stone-200/80">
                      <button onClick={() => setPlace(on ? null : pl.name)} aria-expanded={on}
                        className="group w-full flex items-center gap-4 py-3 text-left">
                        <span className="w-12 h-12 rounded-md overflow-hidden bg-[#f3efe7] shrink-0">{thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block font-display text-base truncate ${on ? 'text-stone-900 underline decoration-theme-accent underline-offset-4' : 'text-stone-800 group-hover:text-stone-900'}`}>{pl.name}</span>
                          <span className="block ng-caption">{pl.posts.length} {pl.posts.length === 1 ? 'sighting' : 'sightings'} · {pl.kinds} {pl.kinds === 1 ? 'kind' : 'kinds'} of life</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {place && <div className="mt-6"><Shelf posts={places.find(x => x.name === place)?.posts.slice(0, 12) || []} onOpenPost={onOpenPost} /></div>}
            </>)}
          </section>

          {/* Recently confirmed */}
          <section aria-labelledby="explore-confirmed">
            <SectionHead id="explore-confirmed" glyph="stamp" title="Recently confirmed" note="Sightings that at least two explorers agreed on." />
            {confirmed === null ? loading : <Shelf posts={confirmed} onOpenPost={onOpenPost} stamp={() => <PlateStamp>Confirmed</PlateStamp>} empty="No confirmed sightings yet. Help by agreeing with an identification you're sure of." />}
          </section>
        </>)}
      </main>
    </div>
  );
};

export default Explore;
