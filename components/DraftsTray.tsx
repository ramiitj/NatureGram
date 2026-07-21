
import React, { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { ExpeditionDraft } from '../types';

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
    });
  }, [userId]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Discard this draft expedition?")) {
      await FirebaseService.deleteDraft(userId, id);
      setDrafts(prev => prev.filter(d => d.id !== id));
    }
  };

  return (
    <div className="h-full bg-day-bg p-8 animate-fade-in">
        <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-display font-black italic text-theme-primary">Saved Drafts</h2>
            <button onClick={onBack} className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-theme-accent shadow-sm hover:opacity-70 transition-colors">
                <span className="material-symbols-outlined">arrow_back</span>
            </button>
        </div>

        {loading ? (
            <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-theme-accent border-t-transparent animate-spin rounded-full"></div></div>
        ) : drafts.length === 0 ? (
            <div className="text-center py-20 opacity-30">
                <span className="material-symbols-outlined text-5xl mb-4">inventory_2</span>
                <p className="catalog-label">No active drafts</p>
            </div>
        ) : (
            <div className="grid gap-4">
                {drafts.map(draft => (
                    <div 
                        key={draft.id} 
                        onClick={() => onResume(draft)}
                        className="bg-white p-5 rounded-2xl border border-theme-primary/10 shadow-sm flex items-center gap-5 active:scale-[0.98] transition-all cursor-pointer"
                    >
                        <div className="w-14 h-14 bg-theme-primary/5 rounded-xl flex items-center justify-center text-theme-accent shrink-0">
                            <span className="material-symbols-outlined text-2xl">science</span>
                        </div>
                        <div className="flex-1">
                            <p className="font-bold text-theme-primary leading-none mb-1">{draft.snapshots.length} Observations</p>
                            <p className="text-[10px] text-theme-primary/40 font-medium">Last active {new Date(draft.timestamp?.toDate?.() || Date.now()).toLocaleDateString()}</p>
                        </div>
                        <button onClick={(e) => handleDelete(e, draft.id)} className="w-10 h-10 rounded-full hover:bg-red-50 text-theme-primary/30 hover:text-red-500 transition-colors">
                            <span className="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                ))}
            </div>
        )}
    </div>
  );
};

export default DraftsTray;
