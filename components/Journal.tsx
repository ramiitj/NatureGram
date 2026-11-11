import React, { useEffect, useMemo, useState } from 'react';
import Community from './Community';
import FieldNotebook, { JournalHeader, JournalView, firstSightingMs } from './FieldNotebook';
import FirstHint from './FirstHint';
import Glyph from './Glyph';
import { PressingLoader } from './SkeletonPost';
import { SpecimenPlate } from './SpecimenPlate';
import { FirebaseService } from '../services/firebaseService';
import { buildLifeList, GROUP_GLYPH } from '../services/lifeList';
import type { CommunityPost, ExpeditionDraft } from '../types';

interface JournalProps {
  userId: string;
  activeDraftsCount?: number;
  onViewDrafts?: () => void;
  /** Opens one draft straight into review */
  onResumeDraft?: (draft: ExpeditionDraft) => void;
  onViewProfile?: (userId: string) => void;
  onPostOpen?: (postId?: string) => void;
  onPostClose?: () => void;
  onLogoClick?: () => void;
  /** The empty journal's way out: open the Lens */
  onOpenLens?: () => void;
  /** …or bring sightings in from the camera roll */
  onImportFromRoll?: () => void;
}

const VIEW_KEY = 'ng_journal_view';
const readView = (): JournalView => {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'species' || v === 'places' ? v : 'pages'; } catch { return 'pages'; }
};

const placeOf = (p: CommunityPost) => String((p as any).locationArea || '').split(',')[0].trim();
const matches = (text: string, q: string) => !q || text.toLowerCase().includes(q.toLowerCase());

/**
 * The explorer's private record: every sighting, shared or only for them, seen three ways.
 *  - Pages: by month, day and outing, in their own words (the field notebook)
 *  - Species: the life list, built from all their sightings; a species opens its pages
 *  - Places: where they have looked; a place opens its pages
 * Drafts sit at the top of Pages as "Unfinished" and open straight into review.
 * (You, the profile, is the public face: shared sightings, followers, settings.)
 */
const Journal: React.FC<JournalProps> = ({
  userId,
  activeDraftsCount,
  onViewDrafts,
  onResumeDraft,
  onViewProfile,
  onPostOpen,
  onPostClose,
  onLogoClick,
  onOpenLens,
  onImportFromRoll,
}) => {
  const [view, setView] = useState<JournalView>(readView);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<ExpeditionDraft[]>([]);
  const [openPost, setOpenPost] = useState<CommunityPost | null>(null);
  const [query, setQuery] = useState('');

  const choose = (v: JournalView) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const unsub = FirebaseService.subscribeToUserJournal(userId, (data) => { setPosts(data); setLoading(false); });
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    FirebaseService.getDrafts(userId).then(d => { if (alive) setDrafts(d); }).catch(() => {});
    return () => { alive = false; };
  }, [userId, activeDraftsCount]);

  const count = posts.length;
  const shared = useMemo(() => posts.filter(p => p.isPublic).length, [posts]);
  const species = useMemo(() => buildLifeList(posts), [posts]);
  const places = useMemo(() => {
    const m = new Map<string, { name: string; count: number; thumb?: string; lastMs: number }>();
    for (const p of posts) {
      const name = placeOf(p);
      if (!name) continue;
      const ms = typeof (p as any).timestamp?.toMillis === 'function' ? (p as any).timestamp.toMillis() : Number((p as any).timestamp) || 0;
      const e = m.get(name) || { name, count: 0, thumb: undefined, lastMs: 0 };
      e.count++;
      if (!e.thumb) e.thumb = (p as any).thumbnailUrl || (p as any).imageUrl;
      e.lastMs = Math.max(e.lastMs, ms);
      m.set(name, e);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || b.lastMs - a.lastMs);
  }, [posts]);
  const unplaced = useMemo(() => posts.filter(p => !placeOf(p)).length, [posts]);

  /** From a species or a place to the pages that hold it */
  const openPagesFor = (q: string) => { setQuery(q); choose('pages'); window.scrollTo?.({ top: 0 }); document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); };

  const emptyState = (
    <div className="ng-empty py-20">
      <Glyph name="rings" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
      <h3 className="ng-empty-title text-[28px] leading-[1.2] not-italic">Your journal starts outside</h3>
      <p className="ng-empty-body text-base">Each outing becomes a page here, dated, placed and in your own words.</p>
      {onOpenLens && (
        <button type="button" onClick={onOpenLens} className="ng-button-primary mt-8">
          <Glyph name="lens" size={20} className="ng-arrow" />Open the Lens
        </button>
      )}
      {onImportFromRoll && (
        <button type="button" onClick={onImportFromRoll} className="ng-link-quiet mt-4 min-h-[44px]">
          Bring in from your camera roll
        </button>
      )}
    </div>
  );

  const shownSpecies = species.filter(e => matches(`${e.name} ${e.scientific || ''} ${e.place || ''}`, query));
  const shownPlaces = places.filter(pl => matches(pl.name, query));

  return (
    <div className="w-full min-h-full bg-day-bg">
      <JournalHeader
        count={count}
        shared={shared}
        firstMs={firstSightingMs(posts)}
        view={view}
        onView={choose}
        query={query}
        onQuery={setQuery}
        onTitleClick={onLogoClick}
      />
      <FirstHint id="journal-views" text="All your sightings, shared or just for you. Pages, Species and Places are three ways into the same ones." />

      {view === 'pages' && (
        <FieldNotebook
          posts={posts}
          loading={loading}
          drafts={drafts}
          onOpenPost={setOpenPost}
          onOpenDrafts={onViewDrafts}
          onOpenDraft={onResumeDraft}
          query={query}
          onClearQuery={() => setQuery('')}
          emptyState={emptyState}
        />
      )}

      {view === 'species' && (
        loading ? <PressingLoader label="Opening your journal" className="py-24" />
        : count === 0 ? emptyState
        : (
          <section className="ng-page pb-28 pt-2" aria-label={`${species.length} species`}>
            <p className="ng-small text-stone-600 mb-5">
              {species.length} {species.length === 1 ? 'species' : 'species'}, numbered in the order you first met them. Tap one to see every time you found it.
            </p>
            {shownSpecies.length === 0 ? (
              <p className="font-display italic text-lg text-stone-500 py-10">No species match "{query}".</p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6" role="list">
                {shownSpecies.map(e => (
                  <li key={`${e.no}-${e.name}`}>
                    <SpecimenPlate
                      size="sm"
                      data={{ name: e.name, scientific: e.scientific, thumb: e.thumb, no: e.no, firstMs: e.firstMs, place: e.place, season: e.season, group: e.group, count: e.count }}
                      onClick={() => openPagesFor(e.name)}
                    />
                    <p className="ng-caption mt-1.5 px-1">{e.count === 1 ? 'Seen once' : `Seen ${e.count} times`}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      )}

      {view === 'places' && (
        loading ? <PressingLoader label="Opening your journal" className="py-24" />
        : count === 0 ? emptyState
        : (
          <section className="ng-page pb-28 pt-2" aria-label={`${places.length} places`}>
            <p className="ng-small text-stone-600 mb-5">
              Where you've looked, most visited first.{unplaced ? ` ${unplaced} ${unplaced === 1 ? 'sighting has' : 'sightings have'} no place.` : ''}
            </p>
            {shownPlaces.length === 0 ? (
              <p className="font-display italic text-lg text-stone-500 py-10">{places.length ? `No places match "${query}".` : 'None of your sightings has a place yet.'}</p>
            ) : (
              <ul className="border-t border-stone-200/80 divide-y divide-stone-200/80" role="list">
                {shownPlaces.map(pl => (
                  <li key={pl.name}>
                    <button type="button" onClick={() => openPagesFor(pl.name)} className="w-full flex items-center gap-4 py-3 text-left">
                      <span className="w-14 h-14 shrink-0 rounded-md bg-[#f3efe7] overflow-hidden flex items-center justify-center text-stone-400">
                        {pl.thumb ? <img src={pl.thumb} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Glyph name="pin" size={20} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-display italic text-lg text-stone-900 truncate">{pl.name}</span>
                        <span className="block ng-caption">{pl.count} {pl.count === 1 ? 'sighting' : 'sightings'}</span>
                      </span>
                      <Glyph name="chevronRight" size={20} className="text-stone-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      )}

      {openPost && (
        <Community
          key={openPost.id}
          currentUserMode={{ type: 'community', userId }}
          isJournalOnly={true}
          detailOnly={true}
          initialPost={openPost}
          backLabel="Journal"
          onViewProfile={onViewProfile}
          onPostOpen={onPostOpen}
          onPostClose={() => { setOpenPost(null); onPostClose?.(); }}
        />
      )}
    </div>
  );
};

export default Journal;
