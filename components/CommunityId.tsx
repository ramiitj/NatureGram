import React, { useEffect, useMemo, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { track } from '../services/analytics';

interface Props {
  postId: string;
  authorId: string;
  primaryLabel?: string;
  currentUserId?: string;
  isMember: boolean;
  onRequireAccount: (reason: string) => void;
}

const norm = (s?: string) => (s || '').trim().toLowerCase();

/**
 * Community identification (iNaturalist-style): explorers confirm or suggest IDs.
 * Consensus of 2+ explorers agreeing with the posted name marks it "Community verified".
 */
const CommunityId: React.FC<Props> = ({ postId, authorId, primaryLabel, currentUserId, isMember, onRequireAccount }) => {
  const [ids, setIds] = useState<{ id: string; name: string; scientificName?: string; note?: string; userName?: string; agree?: boolean }[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { FirebaseService.getIdentifications(postId).then(setIds); }, [postId]);

  const tally = useMemo(() => {
    const m = new Map<string, { name: string; count: number; people: string[] }>();
    ids.forEach(i => {
      const k = norm(i.name);
      const e = m.get(k) || { name: i.name, count: 0, people: [] };
      e.count++; e.people.push(i.userName || 'Explorer');
      m.set(k, e);
    });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [ids]);

  const agreeCount = tally.find(t => norm(t.name) === norm(primaryLabel))?.count || 0;
  const verified = agreeCount >= 2;
  const disputed = !verified && tally.length > 0 && norm(tally[0].name) !== norm(primaryLabel) && tally[0].count >= 2;
  const mine = ids.find(i => i.id === currentUserId);
  const isAuthor = currentUserId === authorId;

  const submit = async (data: { name: string; note?: string; agree?: boolean }) => {
    if (!isMember) { onRequireAccount('Create a free account to help identify sightings.'); return; }
    setBusy(true);
    try {
      await FirebaseService.setIdentification(postId, data);
      track('community_id', { agree: !!data.agree });
      setIds(await FirebaseService.getIdentifications(postId));
      setSuggesting(false); setName(''); setNote('');
    } finally { setBusy(false); }
  };

  // Nothing to show the author until someone else has weighed in
  if (isAuthor && tally.length === 0) return null;

  return (
    <section aria-labelledby={`cid-${postId}`} className="rounded-2xl border border-theme-primary/15 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`cid-${postId}`} className="text-[15px] font-semibold text-theme-primary">{isAuthor ? 'What others say' : 'Is this right?'}</h3>
        {verified && <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"><span className="material-symbols-outlined text-sm" aria-hidden="true">verified</span>Confirmed by {agreeCount} explorers</span>}
        {disputed && <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200">Explorers disagree</span>}
      </div>

      {tally.length === 0 ? null : (
        <ul className="space-y-1.5" role="list">
          {tally.map(t => (
            <li key={t.name} className="flex items-center justify-between text-sm">
              <span className="font-semibold text-stone-900">{t.name}</span>
              <span className="text-stone-600" title={t.people.join(', ')}>{t.count} {t.count === 1 ? 'explorer' : 'explorers'}</span>
            </li>
          ))}
        </ul>
      )}

      {!isAuthor && (
        mine ? (
          <div className="flex items-center justify-between text-sm text-stone-600">
            <span>You said: <strong className="text-stone-900">{mine.name}</strong></span>
            <button onClick={async () => { await FirebaseService.removeIdentification(postId); setIds(await FirebaseService.getIdentifications(postId)); }} className="font-semibold text-stone-700 underline">Withdraw</button>
          </div>
        ) : suggesting ? (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) submit({ name, note }); }} className="space-y-2">
            <label className="block">
              <span className="sr-only">Species name</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Species (common or scientific name)" maxLength={80} required className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-base" />
            </label>
            <label className="block">
              <span className="sr-only">Why (optional)</span>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Field marks that show it (optional)" maxLength={280} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-base" />
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !name.trim()} className="flex-1 py-2.5 rounded-xl bg-theme-primary text-white text-sm font-bold disabled:opacity-40">Suggest this</button>
              <button type="button" onClick={() => setSuggesting(false)} className="px-4 py-2.5 rounded-xl border border-theme-primary/15 text-theme-primary text-sm font-bold">Cancel</button>
            </div>
          </form>
        ) : (
          <div className="flex gap-2">
            {primaryLabel && (
              <button onClick={() => submit({ name: primaryLabel, agree: true })} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-theme-primary text-white text-sm font-bold disabled:opacity-40">
                Yes, it's {primaryLabel.length > 22 ? primaryLabel.slice(0, 20) + '…' : primaryLabel}
              </button>
            )}
            <button onClick={() => isMember ? setSuggesting(true) : onRequireAccount('Create a free account to help identify sightings.')} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 text-theme-primary text-sm font-bold">I think it's…</button>
          </div>
        )
      )}
    </section>
  );
};

export default CommunityId;
