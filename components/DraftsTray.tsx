import React, { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { ExpeditionDraft } from '../types';
import { timeAgo } from '../utils';

interface DraftsTrayProps {
  userId: string;
  onResume: (draft: ExpeditionDraft) => void;
  onBack: () => void;
}

const DraftsTray: React.FC<DraftsTrayProps> = ({ userId, onResume, onBack }) => {
  const [drafts, setDrafts] = useState<ExpeditionDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    FirebaseService.getDrafts(userId).then(d => {
      setDrafts(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  const handleDelete = async (id: string) => {
    if (window.confirm("Discard this draft? Its captures will be deleted.")) {
      await FirebaseService.deleteDraft(userId, id);
      setDrafts(prev => prev.filter(d => d.id !== id));
    }
  };

  return (
    <div className="min-h-full bg-day-bg px-4 py-6 animate-fade-in safe-pt">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} aria-label="Back to feed" className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-stone-800 shadow-sm hover:bg-stone-50">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-stone-900">Drafts</h1>
          <p className="text-sm text-stone-500">Unfinished expeditions. Only you can see these.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20" role="status"><div className="w-8 h-8 border-2 border-theme-accent border-t-transparent animate-spin rounded-full" aria-hidden="true"></div><span className="sr-only">Loading drafts</span></div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-20 text-stone-500">
          <span className="material-symbols-outlined text-5xl mb-3" aria-hidden="true">inventory_2</span>
          <p className="font-semibold text-stone-700">No drafts</p>
          <p className="text-sm mt-1">Tap "Save draft" while reviewing captures to finish them later.</p>
        </div>
      ) : (
        <ul className="grid gap-3" role="list">
          {drafts.map(draft => {
            const thumbs = draft.snapshots.map(s => s.url || s.associatedImages?.[0]?.url).filter(u => u && !u.startsWith('blob:')).slice(0, 3) as string[];
            const firstLabel = draft.snapshots.find(s => s.labels?.[0] && !/^(manual|uploaded|audio|video)/i.test(s.labels[0]))?.labels?.[0];
            return (
              <li key={draft.id} className="bg-white p-3 rounded-2xl border border-stone-100 shadow-sm flex items-center gap-3">
                <button onClick={() => onResume(draft)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                  <span className="relative w-16 h-16 shrink-0">
                    {thumbs.length ? thumbs.map((t, i) => (
                      <img key={i} src={t} alt="" className="absolute w-14 h-14 rounded-xl object-cover border-2 border-white shadow" style={{ left: i * 4, top: i * 4, zIndex: 3 - i }} />
                    )) : <span className="w-16 h-16 bg-stone-100 rounded-xl flex items-center justify-center text-stone-400"><span className="material-symbols-outlined" aria-hidden="true">photo_library</span></span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold text-stone-900 truncate">{firstLabel || 'Expedition'}{draft.snapshots.length > 1 ? ` + ${draft.snapshots.length - 1} more` : ''}</span>
                    <span className="block text-sm text-stone-500">{draft.snapshots.length} capture{draft.snapshots.length === 1 ? '' : 's'} · saved {timeAgo(draft.timestamp?.toDate?.() || draft.timestamp)}</span>
                    <span className="block text-sm font-semibold text-theme-accent mt-0.5">Continue editing →</span>
                  </span>
                </button>
                <button onClick={() => handleDelete(draft.id)} aria-label="Discard draft" className="w-11 h-11 rounded-full hover:bg-red-50 text-stone-500 hover:text-red-700 transition-colors flex items-center justify-center">
                  <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default DraftsTray;
