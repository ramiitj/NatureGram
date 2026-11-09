import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../firebaseConfig';
import { Conversation, DirectMessage, UserProfileData } from '../types';
import { timeAgo } from '../utils';
import { track } from '../services/analytics';

interface Props {
  initialConversationId?: string | null;
  onBack: () => void;
  onViewProfile: (uid: string) => void;
  onOpenPost: (postId: string) => void;
}

const toMs = (t: any) => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0);

const Avatar: React.FC<{ name?: string; url?: string | null; size?: number }> = ({ name, url, size = 48 }) => url
  ? <img src={url} alt="" className="rounded-full object-cover bg-stone-100 shrink-0" style={{ width: size, height: size }} />
  : <span className="rounded-full bg-theme-accent/10 text-theme-accent font-bold flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</span>;

/** Letters: private correspondence between explorers (inbox + 1:1 threads, realtime), written like notes between naturalists. */
const Messages: React.FC<Props> = ({ initialConversationId, onBack, onViewProfile, onOpenPost }) => {
  const me = auth.currentUser?.uid || '';
  const [convos, setConvos] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId || null);
  const [newChat, setNewChat] = useState(false);

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
                      <span className={`block text-sm truncate ${unread ? 'text-stone-900 font-semibold' : 'text-stone-500'}`}>
                        {c.lastMessage ? `${c.lastMessage.senderId === me ? 'You: ' : ''}${c.lastMessage.text}` : 'Write the first line'}
                        {c.lastMessage?.at ? ` · ${timeAgo(c.lastMessage.at)}` : ''}
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
      {newChat && <NewChatSheet onClose={() => setNewChat(false)} onPick={async (uid) => { setNewChat(false); const cid = await FirebaseService.openConversation(uid); setActiveId(cid); }} />}
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
  const endRef = useRef<HTMLDivElement>(null);
  const other = (convo?.participants || cid.split('_')).find(p => p !== me) || '';
  const info = convo?.participantInfo?.[other];

  useEffect(() => FirebaseService.subscribeToMessages(cid, setMsgs), [cid]);
  useEffect(() => { FirebaseService.markConversationRead(cid); }, [cid, msgs?.length]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const grouped = useMemo(() => (msgs || []).map((m, i, arr) => ({ m, showTime: i === 0 || toMs(m.createdAt) - toMs(arr[i - 1].createdAt) > 15 * 60_000 })), [msgs]);

  return (
    <div className="flex-1 flex flex-col bg-day-bg min-h-0">
      <header className="h-14 px-2 flex items-center gap-2 border-b border-theme-primary/10 shrink-0 safe-pt box-content">
        <button onClick={onBack} aria-label="Back to letters" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-stone-100"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <button onClick={() => other && onViewProfile(other)} className="flex items-center gap-2 min-w-0">
          <Avatar name={info?.username} url={info?.avatarUrl} size={36} />
          <span className="font-bold text-stone-900 truncate">{info?.username || 'Explorer'}</span>
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
      {reported && <p role="status" className="px-4 py-2 text-sm bg-stone-100 text-stone-800">Thanks. We'll look into it. You can also block them from their profile.</p>}
      <main className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-1" aria-live="polite" aria-label="Conversation">
        {msgs === null ? <p className="text-center text-stone-500 py-10">Loading…</p> : msgs.length === 0 ? (
          <div className="text-center text-stone-500 py-16">
            <Avatar name={info?.username} url={info?.avatarUrl} size={72} />
            <p className="font-semibold text-stone-800 mt-3">{info?.username || 'Explorer'}</p>
            <p className="text-sm mt-1">Letters are private between the two of you.</p>
          </div>
        ) : grouped.map(({ m, showTime }) => {
          const mine = m.senderId === me;
          return (
            <React.Fragment key={m.id}>
              {showTime && m.createdAt && <p className="text-center text-xs text-stone-500 font-display py-2">{timeAgo(m.createdAt)}</p>}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words border ${mine ? 'bg-insight-bg border-theme-accent/25 text-stone-900' : 'bg-white border-theme-primary/10 text-stone-900'}`}>
                  {m.postId && (
                    <button onClick={() => onOpenPost(m.postId!)} className="flex items-center gap-1.5 mb-1.5 text-sm font-display font-semibold text-theme-accent hover:underline"><span className="material-symbols-outlined text-[16px]" aria-hidden="true">park</span>Open the sighting</button>
                  )}
                  {m.text}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={endRef} />
      </main>
      {error && <p role="alert" className="px-4 pb-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={send} className="shrink-0 p-3 border-t border-theme-primary/10 bg-day-bg flex gap-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <label htmlFor="dm-input" className="sr-only">Your letter</label>
        <textarea
          id="dm-input"
          value={text}
          onChange={e => setText(e.target.value.slice(0, 2000))}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e as any); } }}
          rows={1}
          placeholder="Write to them…"
          className="flex-1 resize-none max-h-32 bg-white border border-theme-primary/15 rounded-xl px-4 py-3 text-base focus:border-theme-accent"
        />
        <button type="submit" disabled={!text.trim() || sending} className="px-4 font-bold text-theme-accent disabled:opacity-40">Send</button>
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
