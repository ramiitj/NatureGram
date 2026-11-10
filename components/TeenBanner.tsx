import React, { useEffect, useState } from 'react';
import Glyph from './Glyph';
import { watchTeen, requestGuardian, shareGuardianLink, TeenState } from '../services/guardian';

const COLLAPSE_KEY = 'ng_teen_banner_folded';

/**
 * A teenage explorer's own state while their notebook waits for a grown-up's OK: what's open to them
 * meanwhile, and a way to send the letter again, pass the link on, or ask someone else. Folds down
 * to a small tab so it never sits in the way of exploring.
 */
const TeenBanner: React.FC<{ state?: TeenState }> = ({ state: forced }) => {
  const [watched, setWatched] = useState<TeenState | null>(null);
  useEffect(() => (forced ? undefined : watchTeen(setWatched)), [forced]);
  const s = forced || watched;
  const [folded, setFolded] = useState(() => { try { return sessionStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');

  if (!s || !s.teen || s.approved) return null;
  const fold = (v: boolean) => { setFolded(v); try { sessionStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
  const needsEmail = s.status === 'none' || s.status === 'declined' || s.status === 'withdrawn';
  const showForm = editing || needsEmail;

  const send = async (parentEmail?: string) => {
    if (busy) return;
    setBusy(true); setNote('');
    const r = await requestGuardian(parentEmail);
    setBusy(false);
    if (!r.ok || !r.data) { setNote(r.message || 'That didn\'t send. Please try again.'); if (r.code === 'email') setEditing(true); return; }
    setEditing(false); setEmail('');
    if (r.data.sent) { setLink(''); setNote(`Sent to ${r.data.to}. Their link works for 7 days.`); }
    else if (r.data.link) { setLink(r.data.link); setNote('Here\'s a fresh link to pass on.'); }
  };

  const heading = s.status === 'declined' ? 'Your grown-up said not now'
    : s.status === 'withdrawn' ? 'Sharing is paused for now'
    : s.status === 'none' ? 'Ask a grown-up to say yes'
    : 'Waiting for a grown-up\'s OK';
  const body = s.status === 'declined' ? 'Your notebook stays private, and everything in it is still yours. If they change their mind, or another grown-up can say yes, ask again here.'
    : s.status === 'withdrawn' ? 'Your grown-up has paused sharing, so your notebook is private again. Everything in it is still yours.'
    : s.status === 'none' ? 'Because you\'re under 18, a parent or guardian needs to say it\'s all right before your notebook can be shared.'
    : 'Your notebook is private until they say yes. Meanwhile you can browse, use the Lens and keep sightings in your journal.';

  if (folded) {
    return (
      <button type="button" onClick={() => fold(false)} className="fixed right-3 bottom-24 z-[89] flex items-center gap-2 min-h-[44px] pl-3 pr-4 rounded-full bg-[#fcfaf8] border border-[#e8dfcd] shadow-[0_8px_24px_-10px_rgba(60,40,20,0.35)] text-sm font-semibold text-stone-800">
        <Glyph name="stamp" size={18} className="text-theme-accent" />{s.status === 'pending' ? 'Waiting for a grown-up\'s OK' : heading}
      </button>
    );
  }

  return (
    <section aria-label="A grown-up's OK" className="fixed left-3 right-3 bottom-24 sm:left-auto sm:right-4 sm:max-w-sm z-[89] bg-[#fcfaf8] rounded-2xl border border-[#e8dfcd] shadow-[0_2px_4px_rgba(60,40,20,0.08),0_18px_40px_-12px_rgba(60,40,20,0.35)] p-4 animate-slide-up">
      <div className="flex gap-3">
        <Glyph name="stamp" size={24} className="text-theme-accent mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-[17px] leading-snug text-text-main">{heading}</h2>
          <p className="text-sm text-stone-700 leading-relaxed mt-1">{body}</p>
        </div>
        <button type="button" onClick={() => fold(true)} aria-label="Fold away" className="-mr-2 -mt-2 w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-900/5">
          <span className="material-symbols-outlined text-xl" aria-hidden="true">expand_more</span>
        </button>
      </div>

      {showForm ? (
        <form onSubmit={e => { e.preventDefault(); send(email.trim()); }} className="mt-3 flex flex-col gap-2">
          <label htmlFor="teen-parent-email" className="text-sm font-semibold text-stone-700">Parent or guardian's email</label>
          <input id="teen-parent-email" type="email" inputMode="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="grown-up@example.com" className="w-full min-h-[44px] bg-white border border-stone-300 rounded-lg px-3 text-base focus:border-theme-accent" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="flex-1 min-h-[44px] rounded-xl bg-theme-primary text-white text-sm font-semibold disabled:opacity-60">{busy ? 'Sending…' : 'Send the letter'}</button>
            {editing && !needsEmail && <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-800">Cancel</button>}
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => send()} disabled={busy} className="flex-1 min-h-[44px] rounded-xl border border-theme-primary/40 bg-white text-theme-primary text-sm font-semibold disabled:opacity-60">{busy ? 'Sending…' : 'Send it again'}</button>
          <button type="button" onClick={() => { setEditing(true); setNote(''); }} className="flex-1 min-h-[44px] rounded-xl border border-theme-primary/40 bg-white text-theme-primary text-sm font-semibold">Change email</button>
        </div>
      )}
      {link && (
        <button type="button" onClick={async () => { const r = await shareGuardianLink(link, s.username); if (r === 'copied') setNote('Link copied. Paste it into a message to them.'); }} className="mt-2 w-full min-h-[44px] rounded-xl bg-theme-primary text-white text-sm font-semibold flex items-center justify-center gap-2">
          <Glyph name="letter" size={18} />Send this to your parent
        </button>
      )}
      {note && <p role="status" className="mt-2 text-[13px] text-stone-600 leading-snug">{note}</p>}
    </section>
  );
};

export default TeenBanner;
