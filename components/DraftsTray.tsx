import React, { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { ExpeditionDraft } from '../types';
import Glyph from './Glyph';
import { PressingLoader } from './SkeletonPost';
import { unfinishedPage, notebookDate } from './FieldNotebook';

interface DraftsTrayProps {
  userId: string;
  onResume: (draft: ExpeditionDraft) => void;
  onBack: () => void;
}

/** Drafts as unfinished notebook pages: when and where each was begun, and a nudge before the details fade. */
const DraftsTray: React.FC<DraftsTrayProps> = ({ userId, onResume, onBack }) => {
  const [drafts, setDrafts] = useState<ExpeditionDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    FirebaseService.getDrafts(userId).then(d => {
      setDrafts(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  const discard = async (id: string) => {
    setDiscarding(true);
    try {
      await FirebaseService.deleteDraft(userId, id);
      setDrafts(prev => prev.filter(d => d.id !== id));
    } finally {
      setDiscarding(false);
      setConfirmId(null);
    }
  };

  return (
    <div className="min-h-full bg-day-bg px-4 py-6 animate-fade-in motion-reduce:animate-none safe-pt">
      <div className="flex items-center gap-3 mb-6 max-w-2xl">
        <button onClick={onBack} aria-label="Back to feed" className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-stone-800 shadow-sm hover:bg-stone-50 shrink-0">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
        <div>
          <h1 className="text-2xl font-display font-semibold text-stone-900">Unfinished pages</h1>
          <p className="text-sm text-stone-500">Outings you started writing up. Only you can see these.</p>
        </div>
      </div>

      {loading ? (
        <PressingLoader label="Gathering your pages" className="py-20" />
      ) : drafts.length === 0 ? (
        <div className="text-center py-20 text-stone-500 flex flex-col items-center">
          <Glyph name="satchel" size={52} strokeWidth={1.2} className="text-stone-400 mb-3" />
          <p className="font-display text-lg text-stone-700">Nothing left unfinished</p>
          <p className="text-sm mt-1 max-w-xs">Tap "Save draft" while reviewing captures to finish the page later.</p>
        </div>
      ) : (
        <ul className="grid gap-3 max-w-2xl" role="list">
          {drafts.map(draft => {
            const pg = unfinishedPage(draft);
            const asking = confirmId === draft.id;
            return (
              <li key={draft.id} className="bg-[#fbf7ef] p-3 rounded-[3px] border border-dashed border-[#cdbfa5]">
                <div className="flex items-center gap-3">
                  <button onClick={() => onResume(draft)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                    <span className="relative w-16 h-16 shrink-0">
                      {pg.thumbs.length ? pg.thumbs.map((t, i) => (
                        <img key={i} src={t} alt="" className="absolute w-14 h-14 object-cover border-2 border-[#fffdf8] shadow-[0_1px_3px_rgba(60,40,20,0.25)]" style={{ left: i * 4, top: i * 4, zIndex: 3 - i, transform: `rotate(${(i - 1) * 2}deg)` }} />
                      )) : <span className="w-16 h-16 bg-[#efe7d6] flex items-center justify-center text-[#b9a98a]"><Glyph name="satchel" size={26} /></span>}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display italic text-[17px] text-stone-900 truncate">{pg.title}{pg.more ? ` and ${pg.more} more` : ''}</span>
                      <span className="block text-sm text-stone-500 truncate">
                        {[pg.ms ? notebookDate(pg.ms) : '', pg.place, `${pg.count} capture${pg.count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                      </span>
                      {pg.fading
                        ? <span className="block text-sm text-theme-accent mt-0.5">Finish it before the details fade</span>
                        : <span className="block text-sm font-medium text-theme-accent mt-0.5">Carry on writing</span>}
                    </span>
                  </button>
                  {!asking && (
                    <button onClick={() => setConfirmId(draft.id)} aria-label={`Discard ${pg.title}`} className="w-11 h-11 rounded-full hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                    </button>
                  )}
                </div>
                {asking && (
                  <div role="alertdialog" aria-label="Discard this page?" className="mt-3 pt-3 border-t border-[#e3d8c4] flex flex-wrap items-center gap-2">
                    <p className="text-sm text-stone-700 flex-1 min-w-[12rem]">Discard this page? Its captures will be deleted too.</p>
                    <button onClick={() => setConfirmId(null)} className="h-9 px-4 rounded-full border border-stone-300 text-sm font-medium text-stone-700 hover:bg-white">Keep it</button>
                    <button onClick={() => discard(draft.id)} disabled={discarding} className="h-9 px-4 rounded-full bg-red-700 text-white text-sm font-medium disabled:opacity-50">{discarding ? 'Discarding…' : 'Discard'}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default DraftsTray;
