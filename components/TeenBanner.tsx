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
  const body = s.status === 'declined' ? 'Your field page stays private, and everything in it is still yours. If they change their mind, or another grown-up can say yes, ask again here.'
    : s.status === 'withdrawn' ? 'Your grown-up has paused sharing, so your field page is private again. Everything in it is still yours.'
    : s.status === 'none' ? 'Because you\'re under 18, a parent or guardian needs to say it\'s all right before your field page can be shared.'
    : 'Your field page is private until they say yes. Meanwhile you can browse, use the Lens and save sightings to your journal.';

  if (folded) {
    return (
      <button type="button" onClick={() => fold(false)} className="fixed right-4 bottom-24 z-[89] flex items-center gap-2 min-h-[44px] pl-3.5 pr-4 rounded-full bg-day-bg border border-stone-200/80 shadow-[0_12px_32px_-16px_rgba(28,25,23,0.45)] text-sm font-medium text-stone-800">
        <Glyph name="stamp" size={20} className="text-stone-500" />{s.status === 'pending' ? 'Waiting for a grown-up\'s OK' : heading}
      </button>
    );
  }

  return (
    <section aria-label="A grown-up's OK" className="fixed left-4 right-4 bottom-24 sm:left-auto sm:right-6 sm:max-w-sm z-[89] bg-day-bg rounded-2xl border border-stone-200/80 shadow-[0_18px_44px_-22px_rgba(28,25,23,0.45)] p-5 ng-rise">
      <div className="flex gap-3">
        <Glyph name="stamp" size={20} className="text-stone-500 mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="ng-subtitle text-[18px]">{heading}</h2>
          <p className="ng-small text-stone-700 mt-1">{body}</p>
        </div>
        <button type="button" onClick={() => fold(true)} aria-label="Fold away" className="-mr-3 -mt-3 ng-icon-button text-stone-500">
          <Glyph name="chevronDown" size={20} />
        </button>
      </div>

      {showForm ? (
        <form onSubmit={e => { e.preventDefault(); send(email.trim()); }} className="mt-4 flex flex-col gap-3">
          <label htmlFor="teen-parent-email" className="ng-label">Parent or guardian's email</label>
          <input id="teen-parent-email" type="email" inputMode="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="grown-up@example.com" className="ng-field w-full min-h-[44px] px-3.5" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="ng-button-primary flex-1 min-h-[44px] text-sm">{busy ? 'Sending…' : 'Send the letter'}</button>
            {editing && !needsEmail && <button type="button" onClick={() => setEditing(false)} className="ng-button-quiet min-h-[44px] px-4 text-sm">Cancel</button>}
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => send()} disabled={busy} className="ng-button-quiet flex-1 min-h-[44px] text-sm">{busy ? 'Sending…' : 'Send it again'}</button>
          <button type="button" onClick={() => { setEditing(true); setNote(''); }} className="ng-button-quiet flex-1 min-h-[44px] text-sm">Change email</button>
        </div>
      )}
      {link && (
        <button type="button" onClick={async () => { const r = await shareGuardianLink(link, s.username); if (r === 'copied') setNote('Link copied. Paste it into a message to them.' /* glossary-ok: a text or email */); }} className="mt-3 ng-button-primary w-full min-h-[44px] text-sm">
          <Glyph name="sealed" size={20} className="ng-arrow" />Send this to your parent
        </button>
      )}
      {note && <p role="status" className="mt-3 ng-small">{note}</p>}
    </section>
  );
};

export default TeenBanner;
