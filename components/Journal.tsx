import React, { useEffect, useState } from 'react';
import Community from './Community';
import FieldNotebook from './FieldNotebook';
import Glyph from './Glyph';
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
}

const VIEW_KEY = 'ng_journal_view';
const readView = (): 'notebook' | 'grid' => {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'notebook'; } catch { return 'notebook'; }
};

/**
 * The explorer's journal. By default a field notebook (days, outings, their own words);
 * the earlier grid stays one tap away. Opening an entry uses the same post view as the feed,
 * so editing, visibility, sharing and deleting own sightings all work exactly as before.
 */
const Journal: React.FC<JournalProps> = ({
  userId,
  activeDraftsCount,
  onViewDrafts,
  onViewProfile,
  onPostOpen,
  onPostClose,
  onLogoClick
}) => {
  const [view, setView] = useState<'notebook' | 'grid'>(readView);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<ExpeditionDraft[]>([]);
  const [openPost, setOpenPost] = useState<CommunityPost | null>(null);

  const choose = (v: 'notebook' | 'grid') => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (view !== 'notebook' || !userId) { setLoading(false); return; }
    setLoading(true);
    const unsub = FirebaseService.subscribeToUserJournal(userId, (data) => { setPosts(data); setLoading(false); });
    return () => unsub();
  }, [userId, view]);

  useEffect(() => {
    if (view !== 'notebook' || !userId) return;
    let alive = true;
    FirebaseService.getDrafts(userId).then(d => { if (alive) setDrafts(d); }).catch(() => {});
    return () => { alive = false; };
  }, [userId, view, activeDraftsCount]);

  if (view === 'grid') {
    return (
      <Community
          currentUserMode={{ type: 'community', userId }}
          isJournalOnly={true}
          backLabel="Profile"
          activeDraftsCount={activeDraftsCount}
          onViewDrafts={onViewDrafts}
          onViewProfile={onViewProfile}
          onPostOpen={onPostOpen}
          onPostClose={onPostClose}
          onLogoClick={onLogoClick}
          headerActions={
            <button type="button" onClick={() => choose('notebook')} className="h-9 px-3 mr-1 rounded-full border border-theme-primary/15 text-theme-primary/80 hover:bg-theme-primary/5 text-sm font-medium flex items-center gap-1.5">
              <Glyph name="notebook" size={16} />Notebook
            </button>
          }
        />
    );
  }

  return (
    <>
      <FieldNotebook
        posts={posts}
        loading={loading}
        drafts={drafts}
        onOpenPost={setOpenPost}
        onOpenDrafts={onViewDrafts}
        onShowGrid={() => choose('grid')}
        onTitleClick={onLogoClick}
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
  );
};

export default Journal;
