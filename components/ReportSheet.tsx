import React, { useState } from 'react';
import Glyph from './Glyph';
import { FirebaseService } from '../services/firebaseService';
import { useBackToClose } from '../services/overlayStack';
import { track } from '../services/analytics';

/**
 * One way to report anything: a sighting, a field note, a Moments clip or an explorer's page.
 * Plain reasons; "Something else" asks for a few words. It never promises more privacy than it
 * can keep: moderators see who reported, the person reported is never told.
 */
export type ReportTarget = { kind: 'post' | 'comment' | 'profile'; postId?: string; commentId?: string; userId?: string };

const REASONS: Record<ReportTarget['kind'], [string, string][]> = {
  post: [
    ['sensitive_location', 'Reveals a sensitive species location'],
    ['wildlife_harm', 'Harming or disturbing wildlife'],
    ['misidentification', 'Dangerous misidentification'],
    ['spam', 'Spam or scam'],
    ['harassment', 'Harassment or hate'],
    ['nudity_violence', 'Nudity or graphic violence'],
    ['ip', 'Not their photo / copyright'],
    ['other', 'Something else'],
  ],
  comment: [
    ['harassment', 'Harassment or hate'],
    ['spam', 'Spam or scam'],
    ['misidentification', 'Dangerous advice or misidentification'],
    ['sensitive_location', 'Reveals a sensitive species location'],
    ['other', 'Something else'],
  ],
  profile: [
    ['impersonation', 'Pretending to be someone else'],
    ['harassment', 'Harassment or hate'],
    ['spam', 'Spam or scam'],
    ['underage', 'May be under 13'],
    ['other', 'Something else'],
  ],
};

/** Sends a report through FirebaseService.reportContent, or the older reportPost for sightings. */
export async function sendReport(target: ReportTarget, reason: string, details = ''): Promise<void> {
  const svc: any = FirebaseService;
  if (typeof svc.reportContent === 'function') { await svc.reportContent(target, reason, details); return; }
  if (target.kind === 'post' && target.postId) { await FirebaseService.reportPost(target.postId, reason, details); return; }
  throw new Error('Reporting this is not available yet.');
}

const ReportSheet: React.FC<{
  target: ReportTarget;
  /** "this sighting", "this field note", "this moment", "this explorer" */
  what: string;
  onClose: () => void;
  /** Called after a report was sent */
  onSent?: (reason: string) => void;
  surface?: string;
}> = ({ target, what, onClose, onSent, surface }) => {
  const { close } = useBackToClose(true, onClose);
  const [other, setOther] = useState(false);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const send = async (reason: string, text = '') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await sendReport(target, reason, text.trim().slice(0, 500));
      track('report', { reason, kind: target.kind, surface: surface || target.kind });
      setSent(true);
      onSent?.(reason);
    } catch (e: any) {
      setError(/sign in/i.test(String(e?.message || '')) ? 'Log in to send a report.' : "The report couldn't be sent. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-end sm:items-center justify-center animate-fade-in motion-reduce:animate-none" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div className="absolute inset-0 ng-scrim" onClick={close} aria-hidden="true" />
      <div className="relative w-full sm:max-w-md ng-sheet px-6 pt-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] animate-slide-up motion-reduce:animate-none text-stone-900">
        {sent ? (
          <div className="text-center py-4" role="status">
            <Glyph name="flag" size={32} strokeWidth={1.2} className="text-stone-400 mb-4" />
            <h2 id="report-title" className="ng-subtitle">Thanks. We'll look at it within a day.</h2>
            <p className="ng-small mt-2">The person you report won't be told who reported them.</p>
            <button onClick={close} className="ng-button-primary w-full mt-6">Done</button>
          </div>
        ) : (
          <>
            <h2 id="report-title" className="ng-subtitle">Why are you reporting {what}?</h2>
            <p className="ng-small mt-1 mb-4">The person you report won't be told who reported them.</p>
            {!other ? (
              <div className="flex flex-col">
                {REASONS[target.kind].map(([key, label]) => (
                  <button key={key} disabled={busy} onClick={() => key === 'other' ? setOther(true) : send(key)} className="text-left min-h-[48px] py-3 border-b border-stone-200/70 last:border-b-0 text-[15px] text-stone-800 hover:text-stone-900 flex items-center justify-between gap-4 disabled:opacity-60">
                    {label}<Glyph name="chevronRight" size={20} className="text-stone-400 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (details.trim()) send('other', details); }} className="flex flex-col gap-3">
                <label htmlFor="report-details" className="ng-label">What's wrong?</label>
                <textarea id="report-details" autoFocus value={details} onChange={e => setDetails(e.target.value.slice(0, 500))} rows={4} className="ng-field w-full resize-none px-4 py-3 leading-[1.6]" placeholder="A few words help us look into it" />
                <button type="submit" disabled={!details.trim() || busy} className="ng-button-primary w-full">{busy ? 'Sending…' : 'Send report'}</button>
                <button type="button" onClick={() => setOther(false)} className="ng-link-quiet min-h-[44px] self-center">Back to the reasons</button>
              </form>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
            <button onClick={close} className="ng-button-quiet w-full mt-4">Cancel</button>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportSheet;
