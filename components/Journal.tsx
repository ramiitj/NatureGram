import React, { useEffect, useState } from 'react';
import Community from './Community';
import FieldNotebook, { JournalHeader, firstSightingMs } from './FieldNotebook';
import FirstHint from './FirstHint';
import Glyph from './Glyph';
import { PressingLoader } from './SkeletonPost';
import { FirebaseService } from '../services/firebaseService';
import type { CommunityPost, ExpeditionDraft } from '../types';

interface JournalProps {
  userId: string;
  activeDraftsCount?: number;
  onViewDrafts?: () => void;
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
const readView = (): 'notebook' | 'grid' => {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'notebook'; } catch { return 'notebook'; }
};

/** The grid shows the feed's chips and filters only once there is enough to sift. */
const GRID_FILTERS_FROM = 20;

/**
 * The explorer's journal: one header, one search and one empty state for both views.
 * By default a field notebook (days, outings, their own words); the grid stays one tap away.
 * Opening a sighting uses the same post view as the feed, so editing, visibility, sharing and
 * deleting own sightings all work exactly as before.
 */
const Journal: React.FC<JournalProps> = ({
  userId,
  activeDraftsCount,
  onViewDrafts,
  onViewProfile,
  onPostOpen,
  onPostClose,
  onLogoClick,
  onOpenLens,
  onImportFromRoll,
}) => {
  const [view, setView] = useState<'notebook' | 'grid'>(readView);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<ExpeditionDraft[]>([]);
  const [openPost, setOpenPost] = useState<CommunityPost | null>(null);
  const [query, setQuery] = useState('');

  const choose = (v: 'notebook' | 'grid') => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };

  // Both views need the count (header, empty state, and when the grid shows filters)
  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const unsub = FirebaseService.subscribeToUserJournal(userId, (data) => { setPosts(data); setLoading(false); });
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    if (view !== 'notebook' || !userId) return;
    let alive = true;
    FirebaseService.getDrafts(userId).then(d => { if (alive) setDrafts(d); }).catch(() => {});
    return () => { alive = false; };
  }, [userId, view, activeDraftsCount]);

  const count = posts.length;
  const gridHasFilters = view === 'grid' && count > GRID_FILTERS_FROM;

  const emptyState = (
    <div className="py-20 flex flex-col items-center text-center px-6">
      <Glyph name="rings" size={48} strokeWidth={1.1} className="text-theme-primary/25 mb-5" />
      <h3 className="text-xl font-display text-stone-800 mb-2 font-semibold">Your journal starts outside</h3>
      <p className="text-base text-stone-600 max-w-xs">Each outing becomes a page here, dated, placed and in your own words.</p>
      {onOpenLens && (
        <button type="button" onClick={onOpenLens} className="mt-7 min-h-[48px] px-7 rounded-full bg-theme-primary text-white font-semibold text-base flex items-center gap-2 shadow-lg active:scale-95 transition-transform">
          <Glyph name="lens" size={20} />Open the Lens
        </button>
      )}
      {onImportFromRoll && (
        <button type="button" onClick={onImportFromRoll} className="mt-3 min-h-[44px] px-4 text-sm font-semibold text-theme-primary underline decoration-theme-primary/30 underline-offset-4 hover:decoration-theme-primary">
          Bring in from your camera roll
        </button>
      )}
    </div>
  );

  return (
    <div className="w-full min-h-full bg-day-bg">
      <JournalHeader
        count={count}
        firstMs={firstSightingMs(posts)}
        view={view}
        onView={choose}
        query={query}
        onQuery={setQuery}
        showSearch={!gridHasFilters}
        onTitleClick={onLogoClick}
      />
      <FirstHint id="journal" text="Every sighting you share or keep lands here, one notebook page per outing." />

      {view === 'grid' ? (
        loading ? <PressingLoader label="Opening your journal" className="py-24" />
        : count === 0 ? emptyState
        : (
          <Community
            currentUserMode={{ type: 'community', userId }}
            isJournalOnly={true}
            journalQuery={gridHasFilters ? null : query}
            backLabel="Profile"
            activeDraftsCount={activeDraftsCount}
            onViewDrafts={onViewDrafts}
            onViewProfile={onViewProfile}
            onPostOpen={onPostOpen}
            onPostClose={onPostClose}
            onLogoClick={onLogoClick}
          />
        )
      ) : (
        <>
          <FieldNotebook
            posts={posts}
            loading={loading}
            drafts={drafts}
            onOpenPost={setOpenPost}
            onOpenDrafts={onViewDrafts}
            query={query}
            onClearQuery={() => setQuery('')}
            emptyState={emptyState}
          />
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
        </>
      )}
    </div>
  );
};

export default Journal;
