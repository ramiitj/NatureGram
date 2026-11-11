import React, { useEffect, useMemo, useState } from 'react';
import Glyph from './Glyph';
import SpecimenPlate, { PlateStamp } from './SpecimenPlate';
import SearchPanel, { plateOfPost, placeOf, PAGE } from './SearchPanel';
import KindChips from './KindChips';
import { FirebaseService } from '../services/firebaseService';
import { groupOf, GROUP_ORDER, LifeGroup, namesOf, toMs } from '../services/lifeList';
import { regionOf, seasonFor } from './Wonder';
import { track } from '../services/analytics';
import { getNaturalistExtra, getThemePeriod } from '../constants/naturalistExtras';
import { CommunityPost } from '../types';
import FirstHint from './FirstHint';

/**
 * Explore: the community's collection laid out like a naturalist's cabinet rather than a feed.
 *  - The one search (components/SearchPanel.tsx, shared with the feed)
 *  - Kinds of life: the life list's groups, the first one open
 *  - Places: where recent sightings were made
 *  - This season: sightings from the season the explorer is in (India's own seasons in India)
 *  - Recently confirmed: sightings at least two explorers have agreed on
 * The fortnight's challenge lives on the feed card and the naturalist's page only.
 * Everything is built from existing public queries; nothing new is stored.
 */
export interface ExploreProps {
  onOpenPost: (postId: string, post?: CommunityPost) => void;
  onOpenProfile: (userId: string) => void;
  /** Back to where Explore was opened from (the arrow at the top) */
  onBack?: () => void;
  /** Where Back goes, shown beside the arrow ("Wild", "Moments"); defaults to "Back" */
  backLabel?: string;
  /** Opens the naturalist of the fortnight (the challenge) */
  onOpenNaturalist?: () => void;
}

/** A shelf of plates: the first twelve, then "Show more" twelve at a time. */
const Shelf: React.FC<{ posts: CommunityPost[]; onOpenPost: ExploreProps['onOpenPost']; stamp?: (p: CommunityPost) => React.ReactNode; empty?: string; what?: string }> = ({ posts, onOpenPost, stamp, empty, what = 'sightings' }) => {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [posts]);
  if (posts.length === 0) return <p className="font-display italic text-base text-stone-500">{empty || 'Nothing here yet.'}</p>;
  return (
    <>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {posts.slice(0, shown).map(p => (
          <li key={p.id}>
            <SpecimenPlate data={plateOfPost(p)} size="sm" stamp={stamp?.(p)} onClick={() => onOpenPost(p.id, p)} />
          </li>
        ))}
      </ul>
      {posts.length > shown && (
        <button type="button" onClick={() => setShown(n => n + PAGE)} className="ng-button-quiet mt-6">Show more<span className="sr-only"> {what}</span> ({posts.length - shown})</button>
      )}
    </>
  );
};

const SEASON_WORD: Record<string, string> = { winter: 'winter', summer: 'summer', monsoon: 'monsoon', postMonsoon: 'post-monsoon', spring: 'spring', autumn: 'autumn' };

/** A section opens as the landing does: the fortnight's fine rule, then the title in serif. */
const SectionHead: React.FC<{ glyph: React.ComponentProps<typeof Glyph>['name']; title: string; note?: string; id: string }> = ({ glyph, title, note, id }) => (
  <div className="mb-6">
    <h2 id={id} className="ng-subtitle flex items-center gap-3"><span className="ng-rule" aria-hidden="true" />{title}<Glyph name={glyph} size={20} className="text-stone-400" /></h2>
    {note && <p className="ng-small mt-1 pl-11">{note}</p>}
  </div>
);

const Explore: React.FC<ExploreProps> = ({ onOpenPost, onOpenProfile, onBack, backLabel = 'Back' }) => {
  const period = useMemo(() => getThemePeriod(), []);
  const extra = getNaturalistExtra(period.theme.id);
  const [recent, setRecent] = useState<CommunityPost[] | null>(null);
  const [confirmed, setConfirmed] = useState<CommunityPost[] | null>(null);
  const [group, setGroup] = useState<LifeGroup | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  // A search arriving from a search engine or a field-guide page: /explore?q=barn+owl
  const [q, setQ] = useState(() => (window.location.pathname.startsWith('/explore') ? (new URLSearchParams(window.location.search).get('q') || '').slice(0, 80) : ''));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { track('explore_open', { from: backLabel.toLowerCase() }); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (attempt) { setRecent(null); setConfirmed(null); }
    // One query of the latest public sightings feeds kinds, places and the season
    FirebaseService.getRecentPublic(200).then(p => { if (alive) { setRecent(p); setFailed(p.length === 0 && typeof navigator !== 'undefined' && navigator.onLine === false); } }).catch(() => { if (alive) { setRecent([]); setFailed(true); } });
    FirebaseService.getRecentlyConfirmed(24).then(p => { if (alive) setConfirmed(p); }).catch(() => { if (alive) setConfirmed([]); });
    return () => { alive = false; };
  }, [attempt]);

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

  /** This season, where the explorer is: sightings from the last four months that fall in it */
  const season = useMemo(() => {
    const region = regionOf();
    const now = new Date();
    const current = seasonFor(now.getMonth(), region);
    const since = now.getTime() - 120 * 86_400_000;
    const posts = (recent || []).filter(p => {
      const ms = toMs((p as any).observedAt) || toMs(p.timestamp);
      return ms >= since && seasonFor(new Date(ms).getMonth(), region) === current;
    });
    return { word: SEASON_WORD[current], posts };
  }, [recent]);

  /** A few species explorers have recorded lately, to offer before anything is typed */
  const suggestions = useMemo(() => {
    const seen = new Map<string, number>();
    (recent || []).forEach(p => { const l = String(namesOf(p).common || '').trim(); if (l && !/^(unknown|nature|unidentified|captured|uploaded)/i.test(l)) seen.set(l, (seen.get(l) || 0) + 1); });
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
  }, [recent]);

  const loading = <p className="ng-small text-stone-500" aria-live="polite">Gathering sightings…</p>;
  const searching = q.trim().length > 0;

  return (
    <div className="min-h-screen shrink-0 w-full bg-day-bg text-text-main pb-24">
      <header className="safe-pt">
        {onBack && (
          // Always in reach while scrolling, and it says where it goes
          <div className="sticky top-0 z-30 bg-day-bg/95 backdrop-blur-sm">
            <div className="max-w-6xl mx-auto ng-page pt-2">
              <button type="button" onClick={onBack} aria-label={backLabel === 'Back' ? 'Back' : `Back to ${backLabel}`} className="flex items-center gap-2 h-11 pr-3 -ml-1 pl-1 rounded-full text-stone-700 hover:text-stone-900 transition-colors">
                <Glyph name="back" size={24} />
                <span className="text-[15px] font-medium">{backLabel}</span>
              </button>
            </div>
          </div>
        )}
        <div className={`max-w-6xl mx-auto ng-page ${onBack ? 'pt-2 md:pt-4' : 'pt-6 md:pt-8'}`}>
          <h1 className="ng-title">Explore</h1>
        </div>
      </header>

      <div className="max-w-6xl mx-auto ng-page pt-6 space-y-12 md:space-y-16 ng-rise">
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
        </section>

        {!searching && (<>
          {failed && (
            <div role="alert" className="flex flex-wrap items-center gap-x-4">
              <p className="ng-small">The collection didn't load. Check your connection and try again.</p>
              <button type="button" onClick={() => setAttempt(a => a + 1)} className="ng-link-quiet min-h-[44px]">Try again</button>
            </div>
          )}

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
                <Shelf posts={groups.find(x => x.group === shownGroup)?.posts || []} onOpenPost={onOpenPost} what={shownGroup ? shownGroup.toLowerCase() : 'sightings'} />
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
              {place && <div className="mt-6"><Shelf posts={places.find(x => x.name === place)?.posts || []} onOpenPost={onOpenPost} what={`sightings near ${place}`} /></div>}
            </>)}
          </section>

          {/* This season */}
          <section aria-labelledby="explore-season">
            <SectionHead id="explore-season" glyph="sun" title="This season" note={`What explorers found this ${season.word}.`} />
            {recent === null ? loading : <Shelf posts={season.posts} onOpenPost={onOpenPost} what={`sightings this ${season.word}`} empty={`Nothing shared yet this ${season.word}. Yours could be the first.`} />}
          </section>

          {/* Recently confirmed */}
          <section aria-labelledby="explore-confirmed">
            <SectionHead id="explore-confirmed" glyph="stamp" title="Recently confirmed" note="Sightings that at least two explorers agreed on." />
            {confirmed === null ? loading : <Shelf posts={confirmed} onOpenPost={onOpenPost} stamp={() => <PlateStamp>Confirmed</PlateStamp>} empty="No confirmed sightings yet. Help by agreeing with an identification you're sure of." />}
          </section>
        </>)}
      </div>
    </div>
  );
};

export default Explore;
