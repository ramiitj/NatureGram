import React, { useEffect, useState } from 'react';
import Glyph from './Glyph';
import { FirebaseService } from '../services/firebaseService';
import { withdrawGuardian, deleteChildAccount, isTeenProfile } from '../services/guardian';
import type { UserProfileData } from '../types';

interface Child { uid: string; username: string; avatarUrl?: string; status: string; deletion: boolean }

/**
 * "Explorers in your care": the teens this account gave consent for, in the parent's settings.
 * Withdrawing consent puts the notebook back to private; deleting is a separate, explicit choice.
 */
const GuardianCare: React.FC<{ uids: string[]; me: string; onToast?: (m: string) => void; preview?: Child[] }> = ({ uids, me, onToast, preview }) => {
  const [children, setChildren] = useState<Child[] | null>(preview || null);
  const [confirm, setConfirm] = useState<{ uid: string; kind: 'withdraw' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (preview) return;
    let alive = true;
    Promise.all(uids.slice(0, 10).map(async uid => {
      const p = await FirebaseService.getUserProfile(uid).catch(() => null) as UserProfileData | null;
      // Only the teens this account is still the parent of record for
      if (!p || !isTeenProfile(p) || p.guardian?.parentUid !== me) return null;
      return { uid, username: p.username || 'Explorer', avatarUrl: p.avatarUrl, status: p.guardian?.status || 'none', deletion: !!p.guardian?.deletionRequestedAt } as Child;
    })).then(list => { if (alive) setChildren(list.filter(Boolean) as Child[]); });
    return () => { alive = false; };
  }, [uids.join(','), me, preview]);

  if (!children || !children.length) return null;

  const act = async () => {
    if (!confirm || busy) return;
    setBusy(true); setError('');
    const r = confirm.kind === 'withdraw' ? await withdrawGuardian(confirm.uid) : await deleteChildAccount(confirm.uid);
    setBusy(false);
    if (!r.ok) { setError(r.message || 'That didn\'t work. Please try again.'); return; }
    setChildren(cs => (cs || []).map(c => c.uid === confirm.uid ? { ...c, status: 'withdrawn', deletion: confirm.kind === 'delete' || c.deletion } : c));
    onToast?.(confirm.kind === 'withdraw' ? 'Consent withdrawn. Their field page is private again.' : 'Their account is closed and will be deleted.');
    setConfirm(null);
  };

  return (
    <section aria-labelledby="in-your-care" className="my-2 mx-3 py-4 border-y border-stone-200/80">
      <h3 id="in-your-care" className="ng-subtitle text-[18px] flex items-center gap-3"><Glyph name="stamp" size={20} className="text-stone-500" />Explorers in your care</h3>
      <ul className="mt-2 flex flex-col" role="list">
        {children.map(c => (
          <li key={c.uid} className="py-3 border-b border-stone-200/70 last:border-b-0">
            <div className="flex items-center gap-3">
              {c.avatarUrl
                ? <img src={c.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                : <span className="w-10 h-10 rounded-full bg-[#f3efe7] flex items-center justify-center font-display text-stone-700" aria-hidden="true">{c.username.slice(0, 1).toUpperCase()}</span>}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-stone-900 truncate">{c.username}</p>
                <p className="ng-caption">{c.deletion ? 'Account closed, being deleted' : c.status === 'approved' ? 'Teen mode, with your OK' : 'Private field page, consent withdrawn'}</p>
              </div>
            </div>
            {!c.deletion && (confirm?.uid === c.uid ? (
              <div className="mt-3 text-sm text-stone-700">
                <p className="leading-[1.6]">{confirm.kind === 'withdraw'
                  ? `${c.username}'s field page goes back to private: nothing they've shared stays in the feed, and they can't share or write letters. Everything they've recorded stays theirs.`
                  : `This closes ${c.username}'s account now and deletes it, with every sighting, photo and letter. It can't be undone.`}</p>
                {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}
                <div className="mt-3 flex gap-3">
                  <button type="button" onClick={act} disabled={busy} className={`flex-1 min-h-[44px] rounded-full text-white text-sm font-semibold disabled:opacity-60 ${confirm.kind === 'delete' ? 'bg-red-800' : 'bg-stone-900'}`}>{busy ? 'One moment…' : confirm.kind === 'withdraw' ? 'Withdraw consent' : 'Delete their account'}</button>
                  <button type="button" onClick={() => { setConfirm(null); setError(''); }} className="ng-button-quiet min-h-[44px] px-4 text-sm">Keep as is</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-3">
                {c.status === 'approved' && <button type="button" onClick={() => setConfirm({ uid: c.uid, kind: 'withdraw' })} className="ng-button-quiet flex-1 min-h-[44px] text-sm">Withdraw consent</button>}
                <button type="button" onClick={() => setConfirm({ uid: c.uid, kind: 'delete' })} className="ng-button-quiet flex-1 min-h-[44px] text-sm !text-red-800 !border-red-200">Delete account</button>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-3 ng-caption">Teen mode keeps ads, tracking and their places off, and letters only between explorers who follow each other. It ends on its own when they turn 18.</p>
    </section>
  );
};

export default GuardianCare;
