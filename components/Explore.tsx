import React, { useEffect, useMemo, useState } from 'react';
import Glyph from './Glyph';
import SpecimenPlate, { PlateData, PlateStamp } from './SpecimenPlate';
import { FirebaseService } from '../services/firebaseService';
import { groupOf, seasonOf, toMs, GROUP_GLYPH, LifeGroup } from '../services/lifeList';
import { getNaturalistExtra, getThemePeriod } from '../constants/naturalistExtras';
import { CommunityPost } from '../types';
import FirstHint from './FirstHint';

/**
 * Explore: the community's collection laid out like a naturalist's cabinet rather than a feed.
 *  - Search the collection (species, places, tags and captions)
 *  - This fortnight's challenge from the featured naturalist, with sightings that answer it
 *  - Kinds of life: drawers of birds, plants, insects, fungi…
 *  - Places: where recent sightings were made (only places explorers chose to share)
 *  - Recently confirmed: sightings at least two explorers have agreed on
 * Everything is built from existing public queries; nothing new is stored.
 */
export interface ExploreProps {
  onOpenPost: (postId: string, post?: CommunityPost) => void;
  onOpenProfile: (userId: string) => void;
  onBack: () => void;
}

const GROUP_ORDER: LifeGroup[] = ['Birds', 'Plants', 'Insects', 'Fungi', 'Mammals', 'Reptiles & amphibians', 'Water life', 'Other life'];
const GROUP_WORDS: Record<LifeGroup, string> = {
  'Birds': 'birds', 'Plants': 'plants', 'Insects': 'insects and other small creatures', 'Fungi': 'fungi',
  'Mammals': 'mammals', 'Reptiles & amphibians': 'reptiles and amphibians', 'Water life': 'water life', 'Other life': 'other life',
};

/** A sighting as a specimen plate. */
const plateOf = (p: CommunityPost): PlateData => {
  const ms = toMs((p as any).observedAt) || toMs(p.timestamp);
  const labels = p.labels || [];
  return {
    name: labels[0] || 'Unnamed sighting',
    scientific: labels[1] && labels[1] !== labels[0] ? labels[1] : undefined,
    thumb: (p as any).thumbSmallUrl || p.thumbnailUrl || (p as any).imageUrl,
    firstMs: ms || undefined,
    place: p.locationArea || undefined,
    season: ms ? seasonOf(ms) : undefined,
    group: groupOf(p),
  };
};

const placeOf = (p: CommunityPost) => String(p.locationArea || '').split(',')[0].trim();

const Shelf: React.FC<{ posts: CommunityPost[]; onOpenPost: ExploreProps['onOpenPost']; stamp?: (p: CommunityPost) => React.ReactNode; empty?: string }> = ({ posts, onOpenPost, stamp, empty }) => (
  posts.length === 0
    ? <p className="text-sm text-stone-500 italic">{empty || 'Nothing here yet.'}</p>
    : (
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {posts.map(p => (
          <li key={p.id}>
            <SpecimenPlate data={plateOf(p)} size="sm" stamp={stamp?.(p)} onClick={() => onOpenPost(p.id, p)} />
          </li>
        ))}
      </ul>
    )
);

const SectionHead: React.FC<{ glyph: React.ComponentProps<typeof Glyph>['name']; title: string; note?: string; id: string }> = ({ glyph, title, note, id }) => (
  <div className="flex items-start gap-3 mb-4">
    <Glyph name={glyph} size={26} className="text-theme-accent shrink-0 mt-0.5" />
    <div>
      <h2 id={id} className="font-display text-xl text-text-main leading-tight">{title}</h2>
      {note && <p className="text-sm text-stone-600 mt-0.5">{note}</p>}
    </div>
  </div>
);

const Explore: React.FC<ExploreProps> = ({ onOpenPost, onOpenProfile, onBack }) => {
  const period = useMemo(() => getThemePeriod(), []);
  const extra = getNaturalistExtra(period.theme.id);
  const [recent, setRecent] = useState<CommunityPost[] | null>(null);
  const [challengePosts, setChallengePosts] = useState<CommunityPost[] | null>(null);
  const [challenge, setChallenge] = useState<{ explorers: number; mine: boolean; capped: boolean } | null>(null);
  const [confirmed, setConfirmed] = useState<CommunityPost[] | null>(null);
  const [group, setGroup] = useState<LifeGroup | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  // A search arriving from a search engine or a field-guide page: /explore?q=barn+owl
  const [q, setQ] = useState(() => (window.location.pathname.startsWith('/explore') ? (new URLSearchParams(window.location.search).get('q') || '').slice(0, 80) : ''));
  const [results, setResults] = useState<CommunityPost[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    FirebaseService.getRecentPublic(90).then(p => { if (alive) setRecent(p); }).catch(() => { if (alive) { setRecent([]); setFailed(true); } });
    FirebaseService.getMorePosts(null, extra.challengeTag, 8).then(r => { if (alive) setChallengePosts(r.posts); }).catch(() => { if (alive) setChallengePosts([]); });
    FirebaseService.getChallengeProgress(extra.challengeTag).then(r => { if (alive) setChallenge(r); }).catch(() => {});
    FirebaseService.getRecentlyConfirmed(8).then(p => { if (alive) setConfirmed(p); }).catch(() => { if (alive) setConfirmed([]); });
    return () => { alive = false; };
  }, [extra.challengeTag]);

  // Search as the explorer types (after a short pause)
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    setSearching(true);
    const t = window.setTimeout(() => {
      FirebaseService.searchPosts(term, 24).then(setResults).catch(() => setResults([])).finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const groups = useMemo(() => {
    const m = new Map<LifeGroup, CommunityPost[]>();
    (recent || []).forEach(p => { const g = groupOf(p); m.set(g, [...(m.get(g) || []), p]); });
    return GROUP_ORDER.filter(g => m.has(g)).map(g => ({ group: g, posts: m.get(g)! }));
  }, [recent]);

  const places = useMemo(() => {
    const m = new Map<string, CommunityPost[]>();
    (recent || []).forEach(p => {
      if ((p as any).showLocation === false) return;
      const name = placeOf(p);
      if (name) m.set(name, [...(m.get(name) || []), p]);
    });
    return [...m.entries()].map(([name, posts]) => ({ name, posts, kinds: new Set(posts.map(p => (p.labels?.[0] || '').toLowerCase()).filter(Boolean)).size }))
      .sort((a, b) => b.posts.length - a.posts.length).slice(0, 12);
  }, [recent]);

  const authors = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    (challengePosts || []).forEach(p => { if (!p.userId) return; const e = m.get(p.userId) || { id: p.userId, name: p.userName || 'Explorer', n: 0 }; e.n++; m.set(p.userId, e); });
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  }, [challengePosts]);

  const loading = <p className="text-sm text-stone-500" aria-live="polite">Opening the drawers…</p>;

  return (
    <div className="min-h-screen shrink-0 w-full bg-[#f7f3ea] text-text-main pb-24">
      <header className="sticky top-0 z-10 bg-[#f7f3ea]/95 backdrop-blur border-b-2 border-theme-accent/25 safe-pt">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2">
          <button onClick={onBack} aria-label="Back" className="w-11 h-11 -ml-2 rounded-full text-theme-deep hover:bg-theme-accent/10 flex items-center justify-center">
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </button>
          <h1 className="font-display text-2xl text-theme-deep">Explore</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-5 space-y-10">
        <FirstHint id="explore" text="Wander by place, by kind of life, or by season." className="!mx-0" />
        {/* Search */}
        <section aria-label="Search the collection">
          <label htmlFor="explore-search" className="sr-only">Search sightings</label>
          <div className="relative">
            <Glyph name="lens" size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-theme-accent" />
            <input
              id="explore-search" type="search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search species, places or tags"
              className="w-full bg-white border border-theme-primary/25 rounded-xl pl-11 pr-4 py-3 text-base placeholder:text-stone-500 outline-none focus:border-theme-accent focus:ring-2 focus:ring-theme-accent/20"
            />
          </div>
          {q.trim().length >= 2 && (
            <div className="mt-4" aria-live="polite">
              {searching && !results ? loading : <Shelf posts={results || []} onOpenPost={onOpenPost} empty={`No sightings match “${q.trim()}” yet.`} />}
            </div>
          )}
        </section>

        {!q.trim() && (<>
          {failed && <p role="status" className="text-sm text-stone-600">The collection didn't load. Check your connection and try again.</p>}

          {/* This fortnight's challenge */}
          <section aria-labelledby="explore-challenge" className="rounded-2xl border border-stone-200 bg-white/70 p-5">
            <SectionHead id="explore-challenge" glyph="compass" title="This fortnight's challenge"
              note={`${period.theme.naturalist}'s invitation · ${period.daysRemaining} ${period.daysRemaining === 1 ? 'day' : 'days'} left`} />
            <p className="font-display italic text-lg leading-snug text-text-main mb-1">{extra.challenge}</p>
            <p className="text-sm text-stone-600 mb-4">
              Tag your sighting <span className="font-semibold text-theme-accent">{extra.challengeTag}</span>
              {challenge ? (challenge.mine ? ' · you have answered it' : challenge.explorers ? ` · ${challenge.capped ? '60+' : challenge.explorers} explorers have answered` : ' · be the first to answer') : ''}
            </p>
            {challengePosts === null ? loading : <Shelf posts={challengePosts.slice(0, 8)} onOpenPost={onOpenPost} stamp={() => <PlateStamp tone="accent">Answers the challenge</PlateStamp>} empty="No answers yet. Yours could be the first." />}
            {authors.length > 0 && (
              <p className="text-sm text-stone-600 mt-4">Answered by{' '}
                {authors.map((a, i) => (
                  <React.Fragment key={a.id}>{i > 0 && (i === authors.length - 1 ? ' and ' : ', ')}<button onClick={() => onOpenProfile(a.id)} className="underline decoration-stone-300 hover:text-theme-accent">{a.name}</button></React.Fragment>
                ))}
              </p>
            )}
          </section>

          {/* Kinds of life */}
          <section aria-labelledby="explore-kinds">
            <SectionHead id="explore-kinds" glyph="press" title="Kinds of life" note="Recent sightings, sorted into drawers." />
            {recent === null ? loading : groups.length === 0 ? <p className="text-sm text-stone-500 italic">No sightings yet.</p> : (<>
              <div role="tablist" aria-label="Kinds of life" className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
                {groups.map(({ group: g, posts }) => {
                  const on = group === g;
                  return (
                    <button key={g} role="tab" aria-selected={on} onClick={() => setGroup(on ? null : g)}
                      className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm transition-colors ${on ? 'border-theme-accent bg-white text-text-main' : 'border-stone-300 bg-transparent text-stone-700 hover:bg-white/70'}`}>
                      <Glyph name={GROUP_GLYPH[g]} size={18} className={on ? 'text-theme-accent' : 'text-stone-500'} />
                      <span>{g}</span><span className="tabular-nums text-stone-500">{posts.length}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4">
                {group
                  ? <Shelf posts={groups.find(x => x.group === group)?.posts.slice(0, 12) || []} onOpenPost={onOpenPost} />
                  : <p className="text-sm text-stone-600">
                      Lately explorers have recorded {groups.slice(0, 3).map(g => `${g.posts.length} ${GROUP_WORDS[g.group]}`).join(', ')}{groups.length > 3 ? ' and more' : ''}. Open a drawer to look closer.
                    </p>}
              </div>
            </>)}
          </section>

          {/* Places */}
          <section aria-labelledby="explore-places">
            <SectionHead id="explore-places" glyph="tracks" title="Places" note="Where recent sightings were made, when explorers chose to share the place." />
            {recent === null ? loading : places.length === 0 ? <p className="text-sm text-stone-500 italic">No shared places yet.</p> : (<>
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {places.map(pl => {
                  const on = place === pl.name;
                  const thumb = (pl.posts[0] as any).thumbSmallUrl || pl.posts[0].thumbnailUrl;
                  return (
                    <li key={pl.name}>
                      <button onClick={() => setPlace(on ? null : pl.name)} aria-expanded={on}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors ${on ? 'border-theme-accent bg-white' : 'border-stone-200 bg-white/60 hover:bg-white'}`}>
                        <span className="w-12 h-12 rounded-lg overflow-hidden bg-stone-200 shrink-0">{thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}</span>
                        <span className="min-w-0">
                          <span className="block font-display text-[15px] truncate">{pl.name}</span>
                          <span className="block text-xs text-stone-500">{pl.posts.length} {pl.posts.length === 1 ? 'sighting' : 'sightings'} · {pl.kinds} {pl.kinds === 1 ? 'kind' : 'kinds'} of life</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {place && <div className="mt-4"><Shelf posts={places.find(x => x.name === place)?.posts.slice(0, 12) || []} onOpenPost={onOpenPost} /></div>}
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
