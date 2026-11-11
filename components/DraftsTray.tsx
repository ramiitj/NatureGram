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
    <div className="min-h-full bg-day-bg ng-page pb-10 ng-rise">
      {/* The way back stays in view while the list scrolls */}
      <div className="sticky top-0 z-10 -mx-4 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 bg-day-bg/95 backdrop-blur">
        <button onClick={onBack} className="inline-flex items-center gap-2 h-11 pr-3 -ml-1 pl-1 rounded-full text-stone-700 hover:text-stone-900">
          <Glyph name="back" size={24} /><span className="text-[15px] font-medium">Journal</span>
        </button>
      </div>
      <div className="mt-2 mb-8 max-w-2xl">
        <div>
          <h1 className="ng-title">Unfinished</h1>
          <p className="ng-small mt-1.5">Outings you started writing up. Only you can see these.</p>
        </div>
      </div>

      {loading ? (
        <PressingLoader label="Gathering your drafts" className="py-20" />
      ) : drafts.length === 0 ? (
        <div className="ng-empty">
          <Glyph name="satchel" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
          <p className="ng-empty-title">Nothing left unfinished</p>
          <p className="ng-empty-body">Tap "Save draft" while reviewing captures to finish the sighting later.</p>
        </div>
      ) : (
        <ul className="max-w-2xl border-t border-stone-200/80" role="list">
          {drafts.map(draft => {
            const pg = unfinishedPage(draft);
            const asking = confirmId === draft.id;
            return (
              <li key={draft.id} className="py-4 border-b border-stone-200/80">
                <div className="flex items-center gap-4">
                  <button onClick={() => onResume(draft)} className="group flex-1 flex items-center gap-4 text-left min-w-0">
                    <span className="relative w-16 h-16 shrink-0">
                      {pg.thumbs.length ? pg.thumbs.map((t, i) => (
                        <img key={i} src={t} alt="" className="absolute w-14 h-14 object-cover rounded-md ring-2 ring-day-bg" style={{ left: i * 4, top: i * 4, zIndex: 3 - i }} />
                      )) : <span className="w-16 h-16 rounded-md bg-[#f3efe7] flex items-center justify-center text-stone-400"><Glyph name="satchel" size={24} strokeWidth={1.2} /></span>}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display italic text-[20px] leading-snug text-stone-900 truncate">{pg.title}{pg.more ? ` and ${pg.more} more` : ''}</span>
                      <span className="block ng-caption truncate mt-0.5">
                        {[pg.ms ? notebookDate(pg.ms) : '', pg.place, `${pg.count} capture${pg.count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                      </span>
                      {pg.fading
                        ? <span className="mt-1 text-sm text-stone-800 flex items-center gap-2"><span className="ng-dot" aria-hidden="true" />Finish it before the details fade</span>
                        : <span className="mt-1 text-sm font-medium text-stone-800 flex items-center gap-1.5">Carry on writing<Glyph name="forward" size={16} className="text-theme-accent transition-transform group-hover:translate-x-0.5" /></span>}
                    </span>
                  </button>
                  {!asking && (
                    <button onClick={() => setConfirmId(draft.id)} aria-label={`Discard ${pg.title}`} className="ng-icon-button text-stone-500">
                      <Glyph name="trash" size={20} />
                    </button>
                  )}
                </div>
                {asking && (
                  <div role="alertdialog" aria-label="Discard this draft?" className="mt-4 flex flex-wrap items-center gap-3">
                    <p className="ng-small text-stone-700 flex-1 min-w-[12rem]">Discard this draft? Its captures will be deleted too.</p>
                    <button onClick={() => setConfirmId(null)} className="ng-button-quiet min-h-[44px] px-5 text-sm">Keep it</button>
                    <button onClick={() => discard(draft.id)} disabled={discarding} className="min-h-[44px] px-5 rounded-full bg-red-700 hover:bg-red-800 text-white text-sm font-semibold disabled:opacity-50">{discarding ? 'Discarding…' : 'Discard'}</button>
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
