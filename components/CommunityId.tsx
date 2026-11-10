import React, { useEffect, useMemo, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { track } from '../services/analytics';
import { PlateStamp } from './SpecimenPlate';
import Glyph from './Glyph';
import { fieldDate, toMs } from '../services/lifeList';

interface Props {
  postId: string;
  authorId: string;
  primaryLabel?: string;
  currentUserId?: string;
  isMember: boolean;
  onRequireAccount: (reason: string) => void;
}

type Det = { id: string; name: string; scientificName?: string; note?: string; userName?: string; agree?: boolean; createdAt?: any };

const norm = (s?: string) => (s || '').trim().toLowerCase();

const thankedKey = (postId: string) => `ng_thanked_${postId}`;
const readThanked = (postId: string): string[] => {
  try { return JSON.parse(localStorage.getItem(thankedKey(postId)) || '[]'); } catch { return []; }
};
const writeThanked = (postId: string, ids: string[]) => {
  try { localStorage.setItem(thankedKey(postId), JSON.stringify(ids)); } catch { /* private mode */ }
};

/**
 * Community identification, presented the way a herbarium sheet collects determinations:
 * each explorer's suggestion is a small slip ("Det. by …") with the name, the field marks
 * they gave, how many species they know and the date. Two or more agreeing with the posted
 * name earns a "Confirmed" stamp. The explorer who posted can thank each identifier.
 */
const CommunityId: React.FC<Props> = ({ postId, authorId, primaryLabel, currentUserId, isMember, onRequireAccount }) => {
  const [ids, setIds] = useState<Det[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [standing, setStanding] = useState<Record<string, string>>({});
  const [thanked, setThanked] = useState<string[]>(() => readThanked(postId));
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    FirebaseService.getIdentifications(postId).then(list => {
      setIds(list as any);
      // Thanks saved on the identification itself (older thanks live only on this device)
      const saved = (list as any[]).filter(i => i.thanked).map(i => i.id);
      if (saved.length) setThanked(prev => Array.from(new Set([...prev, ...saved])));
    });
  }, [postId]);

  // Each identifier's standing, from their profile: species on their list, else sightings shared
  useEffect(() => {
    const todo = ids.map(i => i.id).filter(id => !(id in standing)).slice(0, 12);
    if (!todo.length) return;
    let alive = true;
    Promise.all(todo.map(id => FirebaseService.getUserProfile(id).then(p => {
      const st: any = (p as any)?.stats || {};
      const line = typeof st.species === 'number' && st.species > 0 ? `${st.species} species on their list`
        : typeof st.observations === 'number' && st.observations > 0 ? `${st.observations} sightings` : '';
      return [id, line] as const;
    }).catch(() => [id, ''] as const))).then(rows => { if (alive) setStanding(prev => ({ ...prev, ...Object.fromEntries(rows) })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const tally = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    ids.forEach(i => {
      const k = norm(i.name);
      const e = m.get(k) || { name: i.name, count: 0 };
      e.count++;
      m.set(k, e);
    });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [ids]);

  // Slips: agreeing names first, then by date
  const slips = useMemo(() => [...ids].sort((a, b) => {
    const aa = norm(a.name) === norm(primaryLabel) ? 0 : 1, bb = norm(b.name) === norm(primaryLabel) ? 0 : 1;
    return aa - bb || toMs(a.createdAt) - toMs(b.createdAt);
  }), [ids, primaryLabel]);

  const agreeCount = tally.find(t => norm(t.name) === norm(primaryLabel))?.count || 0;
  const verified = agreeCount >= 2;
  const disputed = !verified && tally.length > 0 && norm(tally[0].name) !== norm(primaryLabel) && tally[0].count >= 2;
  const mine = ids.find(i => i.id === currentUserId);
  const isAuthor = !!currentUserId && currentUserId === authorId;

  const submit = async (data: { name: string; note?: string; agree?: boolean }) => {
    if (!isMember) { onRequireAccount('Create a free account to help identify sightings.'); return; }
    setBusy(true);
    try {
      await FirebaseService.setIdentification(postId, data);
      track('community_id', { agree: !!data.agree, note: !!data.note });
      setIds(await FirebaseService.getIdentifications(postId));
      setSuggesting(false); setName(''); setNote('');
    } finally { setBusy(false); }
  };

  /**
   * Thank an identifier. Sent as an 'identification' notification, the one kind the rules already
   * let a member write to another explorer; remembered on this device so the button settles.
   */
  const thank = async (d: Det) => {
    if (!currentUserId || thanked.includes(d.id)) return;
    const next = [...thanked, d.id];
    setThanked(next); writeThanked(postId, next);
    try {
      // Saved on the slip so the thanks shows everywhere; rules allow only the post's author to set it
      await FirebaseService.thankIdentification(postId, d.id).catch(() => { /* rules not yet deployed: keep the notification */ });
      const me = await FirebaseService.getUserProfile(currentUserId).catch(() => null);
      const who = (me?.username || 'The explorer who posted it').slice(0, 60);
      await FirebaseService.addNotification(d.id, {
        type: 'identification',
        message: `${who} thanked you for your determination: ${d.name.slice(0, 80)}.`,
        postId, senderId: currentUserId, senderName: who,
      } as any);
      track('community_id_thank');
    } catch {
      const back = next.filter(x => x !== d.id);
      setThanked(back); writeThanked(postId, back);
    }
  };

  // Nothing to show the author until someone else has weighed in
  if (isAuthor && tally.length === 0) return null;

  const shown = showAll ? slips : slips.slice(0, 4);

  return (
    <section aria-labelledby={`cid-${postId}`} className="relative rounded-[3px] border border-theme-primary/15 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 pr-16">
        <div>
          <h3 id={`cid-${postId}`} className="text-[17px] font-display text-theme-primary">{isAuthor ? 'Determinations' : 'Is this right?'}</h3>
          {tally.length > 0 && (
            <p className="text-xs text-stone-500 mt-0.5">
              {ids.length} {ids.length === 1 ? 'explorer has' : 'explorers have'} weighed in{disputed ? ', and they disagree' : ''}
            </p>
          )}
        </div>
      </div>
      {verified && (
        <div className="absolute -top-3 right-2 rotate-[8deg]" aria-label={`Confirmed by ${agreeCount} explorers`}>
          <PlateStamp tone="accent">Confirmed by {agreeCount}</PlateStamp>
        </div>
      )}

      {slips.length > 0 && (
        <ul className="space-y-2.5" role="list">
          {shown.map(d => {
            const agrees = norm(d.name) === norm(primaryLabel);
            const when = toMs(d.createdAt);
            return (
              <li key={d.id} className={`relative bg-[#fbf7ef] border border-[#e3d8c4] rounded-[2px] px-3.5 py-3 shadow-[0_1px_1px_rgba(60,40,20,0.06)] ${isAuthor ? 'pr-24' : ''}`}>
                <p className="font-display italic text-[17px] text-[#2f2a22] leading-tight">
                  {d.name}
                  {d.scientificName && norm(d.scientificName) !== norm(d.name) && <span className="text-sm text-[#8a7a60]"> {d.scientificName}</span>}
                </p>
                {d.note && d.note.trim() && (
                  <p className="mt-1.5 text-sm text-stone-700 leading-snug">
                    <span className="sr-only">Field marks: </span>{d.note.trim()}
                  </p>
                )}
                <p className="mt-2 text-xs text-[#8a7a60] border-t border-dashed border-[#e3d8c4] pt-1.5 flex flex-wrap items-center gap-x-1.5">
                  <span>Det. by <span className="text-stone-700 font-medium">{d.userName || 'an explorer'}</span></span>
                  {standing[d.id] && <><span aria-hidden="true">·</span><span>{standing[d.id]}</span></>}
                  {when > 0 && <><span aria-hidden="true">·</span><span>{fieldDate(when)}</span></>}
                  {!agrees && primaryLabel && <><span aria-hidden="true">·</span><span>suggests another name</span></>}
                </p>
                {isAuthor && d.id !== currentUserId && (
                  <button
                    type="button"
                    onClick={() => thank(d)}
                    disabled={thanked.includes(d.id)}
                    className="absolute top-2.5 right-2.5 h-8 px-3 rounded-full border border-theme-primary/15 text-xs font-medium text-theme-primary hover:bg-white disabled:text-stone-500 disabled:hover:bg-transparent"
                  >
                    {thanked.includes(d.id) ? 'Thanked' : 'Thank'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {slips.length > 4 && (
        <button type="button" onClick={() => setShowAll(v => !v)} className="text-sm text-theme-accent font-medium">
          {showAll ? 'Show fewer' : `Show all ${slips.length} determinations`}
        </button>
      )}

      {!isAuthor && (
        mine ? (
          <div className="flex items-center justify-between text-sm text-stone-600">
            <span>Your determination: <em className="font-display text-stone-900">{mine.name}</em></span>
            <button onClick={async () => { await FirebaseService.removeIdentification(postId); setIds(await FirebaseService.getIdentifications(postId)); }} className="font-semibold text-stone-700 underline">Withdraw</button>
          </div>
        ) : suggesting ? (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) submit({ name, note }); }} className="space-y-2">
            <label className="block">
              <span className="sr-only">Species name</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Species (common or scientific name)" maxLength={80} required className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-base" />
            </label>
            <label className="block">
              <span className="text-xs text-stone-500">What shows it? Field marks help the explorer learn.</span>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="For example: white eye-ring, two wing bars" maxLength={280} rows={2} className="mt-1 w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-base resize-none" />
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !name.trim()} className="flex-1 py-2.5 rounded-xl bg-theme-primary text-white text-sm font-bold disabled:opacity-40">Suggest this</button>
              <button type="button" onClick={() => setSuggesting(false)} className="px-4 py-2.5 rounded-xl border border-theme-primary/15 text-theme-primary text-sm font-bold">Cancel</button>
            </div>
          </form>
        ) : (
          <div className="flex gap-2">
            {primaryLabel && (
              <button onClick={() => submit({ name: primaryLabel, agree: true })} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-theme-primary text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-1.5">
                <Glyph name="tag" size={16} />
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
