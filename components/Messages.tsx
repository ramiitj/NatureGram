import React, { useEffect, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../firebaseConfig';
import { Conversation, DirectMessage, UserProfileData } from '../types';
import { timeAgo } from '../utils';
import { track } from '../services/analytics';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import Glyph from './Glyph';
import FirstHint from './FirstHint';

const IGNORE = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)/i;

/** An explorer's recent public sightings: species (labels[0]) and areas. Read-only, one small query. */
const publicTraces = async (uid: string): Promise<{ species: Map<string, string>; areas: string[] }> => {
  const species = new Map<string, string>();
  const areas: string[] = [];
  if (!uid) return { species, areas };
  const snap = await getDocs(query(collection(db, 'feed_thumbnails'), where('userId', '==', uid), where('isPublic', '==', true), orderBy('timestamp', 'desc'), limit(60)));
  snap.forEach(d => {
    const p = d.data() as any;
    const name = String(p.labels?.[0] || '').trim();
    if (name && !IGNORE.test(name)) species.set(name.toLowerCase(), name);
    if (p.showLocation !== false && p.locationArea) areas.push(String(p.locationArea));
  });
  return { species, areas };
};

/** The widest place two lists of areas share: an exact area first, then a shared region ("…, Rajasthan"). */
const sharedRegion = (a: string[], b: string[]): string | null => {
  const clean = (s: string) => s.replace(/^(near|around|in)\s+/i, '').trim();
  const lower = new Set(b.map(x => clean(x).toLowerCase()));
  const exact = a.find(x => lower.has(clean(x).toLowerCase()));
  if (exact) return clean(exact);
  const parts = (s: string) => clean(s).split(',').map(x => x.trim()).filter(x => x.length > 2);
  const bParts = new Set(b.flatMap(x => parts(x).map(p => p.toLowerCase())));
  for (const x of a) {
    const hit = parts(x).find(p => bParts.has(p.toLowerCase()));
    if (hit) return hit;
  }
  return null;
};

/** "Tuesday 10 November, 14:32", like the top of a handwritten note. */
const noteDate = (t: any) => {
  const ms = toMsLocal(t);
  if (!ms) return 'Just now';
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};
const toMsLocal = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);

interface Props {
  initialConversationId?: string | null;
  onBack: () => void;
  onViewProfile: (uid: string) => void;
  onOpenPost: (postId: string) => void;
}

const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);

const Avatar: React.FC<{ name?: string; url?: string | null; size?: number }> = ({ name, url, size = 48 }) => url
  ? <img src={url} alt="" className="rounded-full object-cover bg-stone-100 shrink-0" style={{ width: size, height: size }} />
  : <span className="rounded-full bg-theme-accent/10 text-theme-deep font-bold flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</span>;

/** Letters: private correspondence between explorers (inbox + 1:1 threads, realtime), written like notes between naturalists. */
const Messages: React.FC<Props> = ({ initialConversationId, onBack, onViewProfile, onOpenPost }) => {
  const me = auth.currentUser?.uid || '';
  const [convos, setConvos] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId || null);
  const [newChat, setNewChat] = useState(false);
  // Why a letter couldn't be opened (teen mode: only between explorers who follow each other)
  const [openIssue, setOpenIssue] = useState('');

  useEffect(() => FirebaseService.subscribeToInbox(setConvos), []);
  useEffect(() => { if (initialConversationId) setActiveId(initialConversationId); }, [initialConversationId]);

  const active = convos?.find(c => c.id === activeId) || null;

  if (activeId) {
    return <Thread cid={activeId} convo={active} me={me} onBack={() => setActiveId(null)} onViewProfile={onViewProfile} onOpenPost={onOpenPost} />;
  }

  return (
    <div className="flex-1 flex flex-col bg-day-bg min-h-0">
      <header className="h-14 px-2 flex items-center gap-2 border-b border-theme-primary/10 shrink-0 safe-pt box-content">
        <button onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <h1 className="flex-1 text-xl font-display font-semibold text-theme-primary">Letters</h1>
        <button onClick={() => setNewChat(true)} aria-label="Write a letter" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-theme-primary/5 text-theme-primary"><span className="material-symbols-outlined" style={{ fontVariationSettings: "'wght' 300" }} aria-hidden="true">history_edu</span></button>
      </header>
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <FirstHint id="letters" text="Letters are slow notes between explorers. Ask about a find, or plan a walk." />
        {convos === null ? (
          <p className="text-center text-stone-500 py-16" role="status">Opening your letters…</p>
        ) : convos.length === 0 ? (
          <div className="text-center py-20 px-8 text-stone-500">
            <span className="material-symbols-outlined text-5xl mb-3 text-theme-accent/60" style={{ fontVariationSettings: "'wght' 200" }} aria-hidden="true">mail</span>
            <p className="font-display text-xl text-stone-800">No letters yet</p>
            <p className="text-sm mt-1 max-w-xs mx-auto">Write to an explorer: ask what they saw, where to look, or plan a walk together.</p>
            <button onClick={() => setNewChat(true)} className="mt-5 px-6 py-3 rounded-full bg-theme-primary text-white font-bold text-sm">Write a letter</button>
          </div>
        ) : (
          <ul role="list">
            {convos.map(c => {
              const other = c.participants.find(p => p !== me) || '';
              const info = c.participantInfo?.[other];
              const unread = c.lastMessage && c.lastMessage.senderId !== me && toMs(c.lastMessage.at) > toMs(c.lastReadAt?.[me]);
              return (
                <li key={c.id}>
                  <button onClick={() => setActiveId(c.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 text-left">
                    <Avatar name={info?.username} url={info?.avatarUrl} />
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate ${unread ? 'font-bold text-stone-900' : 'font-semibold text-stone-800'}`}>{info?.username || 'Explorer'}</span>
                      <span className={`flex items-center gap-1 text-sm min-w-0 ${unread ? 'text-stone-900 font-semibold' : 'text-stone-500'}`}>
                        {c.lastMessage?.senderId === me && <Glyph name="feather" size={14} className="text-stone-400" title="You wrote" />}
                        <span className="truncate">
                          {c.lastMessage ? c.lastMessage.text.replace(/\s+/g, ' ') : 'Write the first line'}
                          {c.lastMessage?.at ? ` · ${timeAgo(c.lastMessage.at)}` : ''}
                        </span>
                      </span>
                    </span>
                    {unread && <span className="w-2.5 h-2.5 rounded-full bg-theme-accent shrink-0" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      {newChat && <NewChatSheet onClose={() => setNewChat(false)} onPick={async (uid) => { setNewChat(false); setOpenIssue(''); try { setActiveId(await FirebaseService.openConversation(uid)); } catch (e: any) { setOpenIssue(e?.message || 'That letter couldn\'t be opened just now.'); } }} />}
      {openIssue && <div role="alert" className="fixed left-3 right-3 bottom-24 sm:left-auto sm:right-4 sm:max-w-sm z-[95] bg-[#fcfaf8] border border-[#e8dfcd] rounded-2xl shadow-lg p-4 text-sm text-stone-800 flex gap-3 items-start"><span className="flex-1 leading-relaxed">{openIssue}</span><button onClick={() => setOpenIssue('')} className="font-semibold text-theme-accent min-h-[44px] -my-3">OK</button></div>}
    </div>
  );
};

const Thread: React.FC<{ cid: string; convo: Conversation | null; me: string; onBack: () => void; onViewProfile: (uid: string) => void; onOpenPost: (id: string) => void }> = ({ cid, convo, me, onBack, onViewProfile, onOpenPost }) => {
  const [msgs, setMsgs] = useState<DirectMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [common, setCommon] = useState<{ species: string[]; region: string | null } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const other = (convo?.participants || cid.split('_')).find(p => p !== me) || '';
  const info = convo?.participantInfo?.[other];
  const myName = convo?.participantInfo?.[me]?.username || auth.currentUser?.displayName || 'You';
  const theirName = info?.username || 'Explorer';

  useEffect(() => FirebaseService.subscribeToMessages(cid, setMsgs), [cid]);
  useEffect(() => { FirebaseService.markConversationRead(cid); }, [cid, msgs?.length]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  // Common ground: species you have both recorded, and a region you share (public sightings only)
  useEffect(() => {
    if (!me || !other) return;
    let alive = true;
    Promise.all([publicTraces(me), publicTraces(other)]).then(([a, b]) => {
      if (!alive) return;
      const species = [...a.species.keys()].filter(k => b.species.has(k)).map(k => a.species.get(k)!).slice(0, 6);
      setCommon({ species, region: sharedRegion(a.areas, b.areas) });
    }).catch(() => { if (alive) setCommon({ species: [], region: null }); });
    return () => { alive = false; };
  }, [me, other]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true); setError('');
    try {
      await FirebaseService.sendMessage(cid, text);
      track('dm_sent', { length: text.length });
      setText('');
    } catch {
      setError("Letter not sent. They may have blocked you, or you're offline.");
    } finally { setSending(false); }
  };

  const askWhere = () => {
    const sp = common?.species[0];
    const starter = sp
      ? `Hello ${theirName}, I see we've both recorded the ${sp}. Where do you usually go to look for it?`
      : common?.region
        ? `Hello ${theirName}, we both explore around ${common.region}. Where do you like to go looking?`
        : `Hello ${theirName}, I enjoyed your sightings. Where do you like to go looking?`;
    setText(starter);
    window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(starter.length, starter.length); }, 0);
  };

  const opening = (
    <section aria-label="What you have in common" className="text-center pt-4 pb-6 px-2">
      <Avatar name={info?.username} url={info?.avatarUrl} size={64} />
      <p className="font-display text-lg text-stone-900 mt-3">Letters with {theirName}</p>
      <p className="text-sm text-stone-500 mt-0.5">Private between the two of you.</p>
      {common && (common.species.length > 0 || common.region) && (
        <div className="mt-4 mx-auto max-w-sm text-left rounded-xl bg-white border border-theme-primary/10 px-4 py-3">
          <p className="text-sm text-stone-700">Common ground</p>
          {common.species.length > 0 && (
            <p className="text-[15px] text-stone-900 mt-1 leading-snug">
              You have both recorded {common.species.map((s, i) => (
                <React.Fragment key={s}>{i > 0 && (i === common.species.length - 1 ? ' and ' : ', ')}<span className="font-display italic">{s}</span></React.Fragment>
              ))}.
            </p>
          )}
          {common.region && <p className="text-[15px] text-stone-900 mt-1">You both explore around {common.region}.</p>}
        </div>
      )}
      <button onClick={askWhere} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-theme-accent/40 text-theme-accent text-sm font-semibold hover:bg-theme-accent/5">
        <Glyph name="leafCompass" size={16} /> Ask where to look
      </button>
    </section>
  );

  return (
    <div className="flex-1 flex flex-col bg-day-bg min-h-0">
      <header className="h-14 px-2 flex items-center gap-2 border-b border-theme-primary/10 shrink-0 safe-pt box-content">
        <button onClick={onBack} aria-label="Back to letters" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <button onClick={() => other && onViewProfile(other)} className="flex items-center gap-2 min-w-0">
          <Avatar name={info?.username} url={info?.avatarUrl} size={36} />
          <span className="font-bold text-stone-900 truncate">{theirName}</span>
        </button>
        <button onClick={() => setReporting(true)} disabled={reported} aria-label="Report this conversation" className="ml-auto w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100 text-stone-600 disabled:opacity-40"><span className="material-symbols-outlined" aria-hidden="true">flag</span></button>
      </header>
      {reporting && (
        <div className="px-4 py-3 border-b border-theme-primary/10 bg-white text-sm space-y-2" role="dialog" aria-label="Report this conversation">
          <p className="text-stone-800">Reporting lets NatureGram read this conversation to look into it. Nobody else can read letters.</p>
          <div className="flex flex-wrap gap-2">
            {[['spam', 'Spam or selling'], ['harassment', 'Harassment'], ['unsafe', 'Something unsafe'], ['other', 'Something else']].map(([k, label]) => (
              <button key={k} onClick={async () => { try { await FirebaseService.reportConversation(cid, k); setReported(true); setReporting(false); } catch { setError('Could not send the report. Please try again.'); } }} className="px-3 py-1.5 rounded-full border border-stone-300 hover:bg-stone-50">{label}</button>
            ))}
            <button onClick={() => setReporting(false)} className="px-3 py-1.5 text-stone-600">Cancel</button>
          </div>
        </div>
      )}
      {reported && <p role="status" className="px-4 py-2 text-sm bg-stone-100 text-stone-800">Thanks. We'll look into it. You can also block them from their field page.</p>}
      <main className="flex-1 overflow-y-auto overscroll-contain px-3 py-4" aria-live="polite" aria-label="Letters">
        <div className="max-w-xl mx-auto">
          {opening}
          {msgs === null ? <p className="text-center text-stone-500 py-6">Opening the letters…</p> : (
            <ol className="space-y-4" role="list">
              {msgs.map((m, i) => {
                const mine = m.senderId === me;
                return (
                  <li key={m.id}>
                    <article
                      className={`relative bg-[#fbf7ef] rounded-[3px] px-5 pt-3 pb-4 shadow-[0_1px_2px_rgba(60,40,20,0.10),0_6px_16px_-10px_rgba(60,40,20,0.25)] ${i % 2 ? 'rotate-[0.25deg]' : '-rotate-[0.2deg]'} ${mine ? 'border-l-2 border-theme-accent/50' : 'border-l-2 border-[#d8ccb6]'}`}
                      aria-label={`${mine ? 'You wrote' : `${theirName} wrote`}, ${noteDate(m.createdAt)}`}
                    >
                      <p className="text-xs text-[#8a7a60] font-display italic">{noteDate(m.createdAt)}</p>
                      {m.postId && (
                        <button onClick={() => onOpenPost(m.postId!)} className="flex items-center gap-1.5 mt-2 text-sm font-display font-semibold text-theme-accent hover:underline"><Glyph name="plate" size={16} />Open the sighting</button>
                      )}
                      {m.text && <p className="mt-2 text-[15px] leading-relaxed text-stone-900 whitespace-pre-wrap break-words">{m.text}</p>}
                      <p className="mt-3 text-right font-display italic text-stone-700">— {mine ? myName : theirName}</p>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
          <div ref={endRef} />
        </div>
      </main>
      {error && <p role="alert" className="px-4 pb-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={send} className="shrink-0 p-3 border-t border-theme-primary/10 bg-day-bg pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto">
          <label htmlFor="dm-input" className="sr-only">Your letter to {theirName}</label>
          <textarea
            id="dm-input"
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value.slice(0, 2000))}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            rows={3}
            placeholder={`Dear ${theirName},`}
            aria-describedby="dm-hint"
            className="w-full resize-none max-h-48 bg-[#fbf7ef] border border-[#d8ccb6] rounded-[3px] px-4 py-3 text-base leading-relaxed focus:border-theme-accent"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p id="dm-hint" className="text-xs text-stone-500 hidden sm:block">Ctrl or ⌘ + Enter also sends</p>
            <button type="submit" disabled={!text.trim() || sending} className="ml-auto px-5 py-2.5 rounded-full bg-theme-primary text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40">
              <Glyph name="sealed" size={17} />{sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

const NewChatSheet: React.FC<{ onClose: () => void; onPick: (uid: string) => void }> = ({ onClose, onPick }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserProfileData[]>([]);
  useEffect(() => {
    const t = window.setTimeout(() => { if (q.trim().length >= 2) FirebaseService.searchUsers(q).then(setResults); else setResults([]); }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Write a letter">
      <div className="w-full sm:max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] p-5 max-h-[80dvh] flex flex-col pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-display font-semibold text-theme-primary">Write a letter</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
        </div>
        <label className="block">
          <span className="sr-only">Search explorers</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search explorers by username" className="w-full bg-stone-100 rounded-xl px-4 py-3 text-base" />
        </label>
        <ul className="mt-3 overflow-y-auto" role="list">
          {results.map(u => (
            <li key={u.uid}>
              <button onClick={() => onPick(u.uid)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-stone-50 text-left">
                <Avatar name={u.username} url={u.avatarUrl} size={44} />
                <span className="font-semibold text-stone-900 truncate">{u.username}</span>
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && results.length === 0 && <li className="text-sm text-stone-500 p-3">No explorers found.</li>}
        </ul>
      </div>
    </div>
  );
};

export default Messages;
