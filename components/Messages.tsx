import React, { useEffect, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../firebaseConfig';
import { Conversation, DirectMessage, UserProfileData } from '../types';
import { timeAgo } from '../utils';
import { track } from '../services/analytics';
import { useBackToClose } from '../services/overlayStack';
import { namesOf } from '../services/lifeList';
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
  /** A sighting to send: opens "Write a letter" with it attached ("Send in a letter" from a post) */
  attachPostId?: string | null;
  /** Called once the attached sighting was sent, or the explorer let it go */
  onAttachUsed?: () => void;
}

/** "Indian Roller" for an attached sighting, or a plain fallback while it loads. */
const useSightingName = (postId?: string | null) => {
  const [name, setName] = useState('');
  useEffect(() => {
    setName('');
    if (!postId) return;
    let alive = true;
    FirebaseService.getPost(postId).then(p => {
      if (!alive) return;
      const n = p ? (namesOf(p).common || p.title || '') : '';
      setName(n && !IGNORE.test(n) ? n : 'a sighting');
    }).catch(() => { if (alive) setName('a sighting'); });
    return () => { alive = false; };
  }, [postId]);
  return name;
};

const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);

const Avatar: React.FC<{ name?: string; url?: string | null; size?: number }> = ({ name, url, size = 48 }) => url
  ? <img src={url} alt="" className="rounded-full object-cover bg-stone-100 shrink-0" style={{ width: size, height: size }} />
  : <span className="rounded-full bg-[#f3efe7] text-stone-700 font-display flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</span>;

/** Letters: private correspondence between explorers (inbox + 1:1 threads, realtime), written like notes between naturalists. */
const Messages: React.FC<Props> = ({ initialConversationId, onBack, onViewProfile, onOpenPost, attachPostId = null, onAttachUsed }) => {
  const me = auth.currentUser?.uid || '';
  const [convos, setConvos] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId || null);
  // A thread opened from elsewhere (a notification, a profile) goes back there; one opened here goes back to the inbox
  const [fromOutside, setFromOutside] = useState(!!initialConversationId);
  const [newChat, setNewChat] = useState(!!attachPostId);
  /** The sighting travelling with the next letter */
  const [attach, setAttach] = useState<string | null>(attachPostId);
  const attachName = useSightingName(attach);
  // Why a letter couldn't be opened (teen mode: only between explorers who follow each other)
  const [openIssue, setOpenIssue] = useState('');

  useEffect(() => FirebaseService.subscribeToInbox(setConvos), []);
  useEffect(() => { if (initialConversationId) { setActiveId(initialConversationId); setFromOutside(true); } }, [initialConversationId]);
  useEffect(() => { if (attachPostId) { setAttach(attachPostId); setActiveId(null); setNewChat(true); } }, [attachPostId]);

  const dropAttach = () => { if (attach) { setAttach(null); onAttachUsed?.(); } };
  const { close: closeThread } = useBackToClose(!!activeId && !fromOutside, () => setActiveId(null));
  const openThread = (cid: string) => { setFromOutside(false); setActiveId(cid); };

  const active = convos?.find(c => c.id === activeId) || null;

  if (activeId) {
    return (
      <Thread
        cid={activeId}
        convo={active}
        me={me}
        backLabel={fromOutside ? 'Back' : 'Back to letters'}
        onBack={() => { if (fromOutside) { setActiveId(null); setFromOutside(false); onBack(); } else closeThread(); }}
        onViewProfile={onViewProfile}
        onOpenPost={onOpenPost}
        attachPostId={attach}
        attachName={attachName}
        onDropAttach={dropAttach}
        onAttachSent={() => { setAttach(null); onAttachUsed?.(); }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-day-bg min-h-0">
      <header className="h-16 px-4 md:px-10 flex items-center gap-2 border-b border-stone-200/80 shrink-0 safe-pt box-content">
        <button onClick={onBack} aria-label="Back" className="ng-icon-button -ml-2"><Glyph name="back" size={24} /></button>
        <h1 className="flex-1 font-display text-[20px] text-stone-900">Letters</h1>
        <button onClick={() => setNewChat(true)} aria-label="Write a letter" className="ng-icon-button -mr-2"><Glyph name="feather" size={24} /></button>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <FirstHint id="letters" text="Letters are slow notes between explorers. Ask about a find, or plan a walk." />
        {convos === null ? (
          <p className="text-center font-display italic text-stone-500 py-16" role="status">Opening your letters…</p>
        ) : convos.length === 0 ? (
          <div className="ng-empty py-20">
            <Glyph name="letter" size={40} strokeWidth={1.2} className="ng-empty-glyph" />
            <p className="ng-empty-title">No letters yet</p>
            <p className="ng-empty-body">Write to an explorer: ask what they saw, where to look, or plan a walk together.</p>
            <button onClick={() => setNewChat(true)} className="ng-button-primary mt-8">Write a letter<Glyph name="forward" size={20} className="ng-arrow" /></button>
          </div>
        ) : (
          <ul role="list">
            {convos.map(c => {
              const other = c.participants.find(p => p !== me) || '';
              const info = c.participantInfo?.[other];
              const unread = c.lastMessage && c.lastMessage.senderId !== me && toMs(c.lastMessage.at) > toMs(c.lastReadAt?.[me]);
              return (
                <li key={c.id}>
                  <button onClick={() => openThread(c.id)} className="w-full flex items-center gap-4 px-6 md:px-10 py-4 border-b border-stone-200/70 hover:bg-stone-900/[0.02] text-left">
                    <Avatar name={info?.username} url={info?.avatarUrl} />
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate ${unread ? 'font-semibold text-stone-900' : 'font-medium text-stone-800'}`}>{info?.username || 'Explorer'}</span>
                      <span className={`flex items-center gap-1 text-sm min-w-0 ${unread ? 'text-stone-800' : 'text-stone-500'}`}>
                        {c.lastMessage?.senderId === me && <Glyph name="feather" size={14} className="text-stone-400" title="You wrote" />}
                        <span className="truncate">
                          {c.lastMessage ? c.lastMessage.text.replace(/\s+/g, ' ') : 'Write the first line'}
                          {c.lastMessage?.at ? ` · ${timeAgo(c.lastMessage.at)}` : ''}
                        </span>
                      </span>
                    </span>
                    {unread && <span className="ng-dot shrink-0" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {newChat && (
        <NewChatSheet
          me={me}
          convos={convos || []}
          attachName={attach ? (attachName || 'a sighting') : ''}
          onClose={() => { setNewChat(false); dropAttach(); }}
          onPick={async (uid) => { setNewChat(false); setOpenIssue(''); try { openThread(await FirebaseService.openConversation(uid)); } catch (e: any) { dropAttach(); setOpenIssue(e?.message || 'That letter couldn\'t be opened just now.'); } }}
        />
      )}
      {openIssue && <div role="alert" className="fixed left-6 right-6 bottom-24 sm:left-auto sm:right-6 sm:max-w-sm z-[95] ng-toast rounded-2xl pl-5 pr-3 py-3 flex gap-3 items-center"><span className="flex-1 leading-[1.5]">{openIssue}</span><button onClick={() => setOpenIssue('')} className="font-semibold text-white underline underline-offset-4 decoration-white/40 min-h-[44px] px-2">OK</button></div>}
    </div>
  );
};

const Thread: React.FC<{
  cid: string; convo: Conversation | null; me: string; onBack: () => void; backLabel: string;
  onViewProfile: (uid: string) => void; onOpenPost: (id: string) => void;
  attachPostId?: string | null; attachName?: string; onDropAttach?: () => void; onAttachSent?: () => void;
}> = ({ cid, convo, me, onBack, backLabel, onViewProfile, onOpenPost, attachPostId, attachName, onDropAttach, onAttachSent }) => {
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
  // Only a new letter from them is announced, not the whole thread
  const [announce, setAnnounce] = useState('');
  const seenCount = useRef<number | null>(null);
  useEffect(() => {
    if (!msgs) return;
    if (seenCount.current !== null && msgs.length > seenCount.current) {
      const last = msgs[msgs.length - 1];
      if (last && last.senderId !== me) setAnnounce(`New letter from ${theirName}: ${(last.text || 'a sighting').slice(0, 140)}`);
    }
    seenCount.current = msgs.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs?.length]);

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
    if ((!text.trim() && !attachPostId) || sending) return;
    setSending(true); setError('');
    try {
      await FirebaseService.sendMessage(cid, text, attachPostId || undefined);
      track('dm_sent', { length: text.length, sighting: !!attachPostId });
      if (attachPostId) onAttachSent?.();
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
    <section aria-label="What you have in common" className="text-center pt-6 pb-10 px-2">
      <Avatar name={info?.username} url={info?.avatarUrl} size={64} />
      <p className="ng-subtitle italic mt-4">Letters with {theirName}</p>
      <p className="ng-small text-stone-500 mt-1">Private between the two of you.</p>
      {common && (common.species.length > 0 || common.region) && (
        <div className="mt-6 mx-auto max-w-sm text-left py-4 border-y border-stone-200/80">
          <p className="ng-kicker">Common ground</p>
          {common.species.length > 0 && (
            <p className="text-[15px] text-stone-800 mt-2 leading-[1.6]">
              You have both recorded {common.species.map((s, i) => (
                <React.Fragment key={s}>{i > 0 && (i === common.species.length - 1 ? ' and ' : ', ')}<span className="font-display italic">{s}</span></React.Fragment>
              ))}.
            </p>
          )}
          {common.region && <p className="text-[15px] text-stone-800 mt-1 leading-[1.6]">You both explore around {common.region}.</p>}
        </div>
      )}
      <button onClick={askWhere} className="mt-5 inline-flex items-center gap-2 ng-link-quiet min-h-[44px]">
        <Glyph name="leafCompass" size={20} className="text-stone-500" /> Ask where to look
      </button>
    </section>
  );

  return (
    <div className="flex-1 flex flex-col bg-day-bg min-h-0">
      <header className="h-16 px-4 md:px-10 flex items-center gap-2 border-b border-stone-200/80 shrink-0 safe-pt box-content">
        <button onClick={onBack} aria-label={backLabel} className="ng-icon-button -ml-2"><Glyph name="back" size={24} /></button>
        <button onClick={() => other && onViewProfile(other)} className="flex items-center gap-3 min-w-0">
          <Avatar name={info?.username} url={info?.avatarUrl} size={36} />
          <span className="font-medium text-stone-900 truncate">{theirName}</span>
        </button>
        <button onClick={() => setReporting(true)} disabled={reported} aria-label="Report this conversation" className="ml-auto ng-icon-button -mr-2 text-stone-500"><Glyph name="flag" size={20} /></button>
      </header>
      {reporting && (
        <div className="px-6 md:px-10 py-4 border-b border-stone-200/80 text-sm space-y-3" role="dialog" aria-label="Report this conversation">
          <p className="text-stone-700 leading-[1.6]">Reporting lets NatureGram read this conversation to look into it. Nobody else can read letters.</p>
          <div className="flex flex-wrap gap-2">
            {[['spam', 'Spam or selling'], ['harassment', 'Harassment'], ['unsafe', 'Something unsafe'], ['other', 'Something else']].map(([k, label]) => (
              <button key={k} onClick={async () => { try { await FirebaseService.reportConversation(cid, k); setReported(true); setReporting(false); } catch { setError('Could not send the report. Please try again.'); } }} className="ng-chip">{label}</button>
            ))}
            <button onClick={() => setReporting(false)} className="ng-link-quiet min-h-[44px] px-2">Cancel</button>
          </div>
        </div>
      )}
      {reported && <p role="status" className="px-6 md:px-10 py-3 ng-small border-b border-stone-200/80">Thanks. We'll look into it. You can also block them from their field page.</p>}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <section className="flex-1 overflow-y-auto overscroll-contain px-6 py-6" aria-label={`Letters with ${theirName}`}>
        <div className="max-w-xl mx-auto">
          {opening}
          {msgs === null ? <p className="text-center font-display italic text-stone-500 py-6">Opening the letters…</p> : (
            <ol className="space-y-6" role="list">
              {msgs.map((m, i) => {
                const mine = m.senderId === me;
                return (
                  <li key={m.id}>
                    <article
                      className={`relative bg-[#fbf7ef] rounded-md px-6 pt-4 pb-5 border border-[#e8dfcd] ${mine ? 'ml-6 sm:ml-12' : 'mr-6 sm:mr-12'}`} data-i={i}
                      aria-label={`${mine ? 'You wrote' : `${theirName} wrote`}, ${noteDate(m.createdAt)}`}
                    >
                      <p className="ng-caption font-display italic text-[13px]">{noteDate(m.createdAt)}</p>
                      {m.postId && (
                        <button onClick={() => onOpenPost(m.postId!)} className="flex items-center gap-2 mt-2 min-h-[44px] ng-link-quiet"><Glyph name="plate" size={20} className="text-stone-500" />Open the sighting</button>
                      )}
                      {m.text && <p className="mt-2 text-base leading-[1.65] text-stone-800 whitespace-pre-wrap break-words">{m.text}</p>}
                      <p className="mt-4 text-right font-display italic text-stone-600">— {mine ? myName : theirName}</p>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
          <div ref={endRef} />
        </div>
      </section>
      {error && <p role="alert" className="px-6 pb-2 text-sm text-red-800">{error}</p>}
      <form onSubmit={send} className="shrink-0 px-6 pt-4 border-t border-stone-200/80 bg-day-bg pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto">
          {attachPostId && (
            <div className="mb-3 flex items-center gap-3 px-4 py-2 rounded-md bg-[#fbf7ef] border border-[#e8dfcd]">
              <Glyph name="plate" size={20} className="text-stone-500 shrink-0" />
              <p className="flex-1 min-w-0 text-sm text-stone-800 truncate">Sending: <span className="font-display italic">{attachName || 'a sighting'}</span></p>
              <button type="button" onClick={onDropAttach} aria-label="Don't send the sighting" className="ng-icon-button -mr-2 text-stone-500"><Glyph name="close" size={20} /></button>
            </div>
          )}
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
            className="ng-field w-full resize-none max-h-48 px-4 py-3 leading-[1.6]"
          />
          <div className="mt-3 flex items-center justify-between gap-4">
            <p id="dm-hint" className="ng-caption hidden sm:block">Ctrl or ⌘ + Enter also sends</p>
            <button type="submit" disabled={(!text.trim() && !attachPostId) || sending} className="ml-auto ng-button-primary">
              <Glyph name="sealed" size={20} className="ng-arrow" />{sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

const NewChatSheet: React.FC<{ onClose: () => void; onPick: (uid: string) => void; me: string; convos: Conversation[]; attachName?: string }> = ({ onClose, onPick, me, convos, attachName }) => {
  const { close } = useBackToClose(true, onClose);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserProfileData[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = window.setTimeout(() => {
      FirebaseService.searchUsers(term).then(r => { if (alive) setResults(r); }).catch(() => { if (alive) setResults([]); }).finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q]);
  // People already written to, for a quick pick before anything is typed
  const recent = convos.slice(0, 6).map(c => {
    const uid = c.participants.find(p => p !== me) || '';
    return { uid, name: c.participantInfo?.[uid]?.username || 'Explorer', url: c.participantInfo?.[uid]?.avatarUrl };
  }).filter(r => r.uid);
  const typed = q.trim().length >= 2;
  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="new-letter-title">
      <div className="absolute inset-0 ng-scrim" onClick={close} aria-hidden="true" />
      <div className="relative w-full sm:max-w-md ng-sheet px-6 pt-5 max-h-[80dvh] flex flex-col pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between mb-4">
          <h2 id="new-letter-title" className="ng-subtitle">Write a letter</h2>
          <button onClick={close} aria-label="Close" className="ng-icon-button -mr-2"><Glyph name="close" size={24} /></button>
        </div>
        {attachName && (
          <p className="mb-4 flex items-center gap-3 px-4 py-2 rounded-md bg-[#fbf7ef] border border-[#e8dfcd] text-sm text-stone-800">
            <Glyph name="plate" size={20} className="text-stone-500 shrink-0" />
            <span className="truncate">Sending: <span className="font-display italic">{attachName}</span></span>
          </p>
        )}
        <label className="block">
          <span className="sr-only">Search explorers</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search explorers by username" className="ng-field-line" />
        </label>
        <p className="sr-only" role="status" aria-live="polite">{typed ? (searching ? 'Searching…' : `${results.length} ${results.length === 1 ? 'explorer' : 'explorers'} found`) : ''}</p>
        {!typed && recent.length > 0 && <p className="ng-caption mt-4">People you have written to</p>}
        <ul className="mt-3 overflow-y-auto" role="list">
          {(typed ? results.map(u => ({ uid: u.uid, name: u.username, url: u.avatarUrl })) : recent).map(u => (
            <li key={u.uid}>
              <button onClick={() => onPick(u.uid)} className="w-full flex items-center gap-4 py-3 border-b border-stone-200/70 text-left">
                <Avatar name={u.name} url={u.url} size={44} />
                <span className="font-medium text-stone-900 truncate">{u.name}</span>
              </button>
            </li>
          ))}
          {typed && searching && results.length === 0 && <li className="ng-small py-3">Searching…</li>}
          {typed && !searching && results.length === 0 && <li className="ng-small py-3">No explorers found.</li>}
        </ul>
      </div>
    </div>
  );
};

export default Messages;
