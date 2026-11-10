import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebaseConfig';
import { apiUrl } from '../services/apiOrigin';
import { FirebaseService } from '../services/firebaseService';
import AiQualityPanel from './AiQualityPanel';
import Glyph, { GlyphName } from './Glyph';
import { PressingLoader } from './SkeletonPost';
import { markSvg, resolveColors, BrandingConfig, isSafeIcon } from '../services/brandMark';
import { NATURALIST_THEMES, getDailyTheme } from '../constants/naturalists';

/**
 * NatureGram admin console: the curator's office. Every read and change goes through the server's
 * admin API, which checks that the caller is the named admin, validates the change, keeps the previous
 * version and writes the audit log. Nothing here talks to the database directly.
 */

type Section = 'overview' | 'controls' | 'ai' | 'monitor' | 'review' | 'people' | 'letters' | 'experiments' | 'branding' | 'data' | 'security';

const SECTIONS: { id: Section; label: string; glyph: GlyphName; blurb: string }[] = [
  { id: 'overview', label: 'Overview', glyph: 'plate', blurb: 'How the field station is doing today. The figures refresh every minute.' },
  { id: 'controls', label: 'Allowances & switches', glyph: 'scales', blurb: 'Daily allowances, what is switched on for everyone, and spending limits.' },
  { id: 'ai', label: 'AI governance', glyph: 'feather', blurb: "The guide's instructions, the platform policy, the models and the messages explorers see." },
  { id: 'monitor', label: 'AI monitor', glyph: 'guide', blurb: "Every call the guide makes, today's usage, and how often explorers correct it." },
  { id: 'review', label: 'Review', glyph: 'stamp', blurb: 'Sightings and field notes waiting for a decision, and reports from explorers.' },
  { id: 'people', label: 'People', glyph: 'binoculars', blurb: 'Look up an explorer, see what they have been doing, and step in when needed.' },
  { id: 'letters', label: 'Reported letters', glyph: 'sealed', blurb: 'Conversations an explorer has reported. Only these can be read.' },
  { id: 'experiments', label: 'Experiments', glyph: 'compass', blurb: 'Feature flags and A/B tests. Each explorer always lands in the same group.' },
  { id: 'branding', label: 'Branding', glyph: 'sun', blurb: "NatureGram's mark in the browser tab and on home screens. By default it is the landing sun in the colours of the naturalist of the fortnight." },
  { id: 'data', label: 'Data explorer', glyph: 'notebook', blurb: 'Exports, maintenance jobs and a read-only look at the records.' },
  { id: 'security', label: 'Audit & security', glyph: 'seal', blurb: 'Who holds the keys, blocked networks, server safety settings and every admin action.' },
];

class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }

/** Wait for Firebase to restore the sign-in (opening /admin directly races it), then get a token. */
async function adminToken(): Promise<string> {
  try { await (auth as any).authStateReady?.(); } catch { /* older SDK */ }
  return (await auth.currentUser?.getIdToken()) || '';
}

async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const token = await adminToken();
  const res = await fetch(apiUrl(`/api/admin${path}`), {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token || ''}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || `Request failed (${res.status})`, res.status, json.code);
  return json as T;
}

/** Download a file from the admin API (for exports). */
async function download(path: string, fallbackName: string): Promise<{ count: string | null; skipped: string | null }> {
  const token = await adminToken();
  const res = await fetch(apiUrl(`/api/admin${path}`), { headers: { Authorization: `Bearer ${token || ''}` } });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(j.error || `Export failed (${res.status})`, res.status); }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { count: res.headers.get('X-Export-Count'), skipped: res.headers.get('X-Export-Skipped') };
}

const KIND_LABEL: Record<string, string> = {
  safety: 'Held by the safety check', privacy: 'Privacy review', unchecked: 'Published while the image check was down', comment: 'Field note held by the word check',
};
const REASON_LABEL: Record<string, string> = {
  unsafe: 'image may be unsafe', words: 'abusive words', spam: 'looks like spam', people: 'people', faces: 'faces', plates: 'number plates',
  screen: 'screen or document', notNature: 'no nature subject', unchecked: 'not checked',
};
/** The app-wide switches, in plain words. */
const SWITCHES: [string, string][] = [
  ['aiEnabled', 'All AI features'], ['liveEnabled', 'Live guide'], ['uploadsEnabled', 'Sharing new sightings'],
  ['guestsEnabled', 'Guests using AI'], ['lettersEnabled', 'Letters'], ['signupsEnabled', 'New accounts'],
];

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : '–');
const n = (v: any) => (typeof v === 'number' ? v.toLocaleString() : '–');

// ---------------------------------------------------------------------------- the office's stationery

const INPUT = 'mt-1 w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500';
const RULE = 'border-[#e8dfcd]';
const DIVIDE = 'divide-[#e8dfcd]';

const Card: React.FC<{ title?: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode }> = ({ title, children, className = '', actions }) => (
  <section className={`bg-[#fffdf8] border border-[#e3d8c4] rounded-md p-4 sm:p-5 shadow-[0_1px_2px_rgba(60,40,20,0.06)] min-w-0 ${className}`}>
    {(title || actions) && (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
        {title && <h3 className="font-display text-lg leading-snug text-stone-900 min-w-0 break-words">{title}</h3>}
        {actions}
      </div>
    )}
    {children}
  </section>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'warn'; onClick?: () => void; hint?: string }> = ({ label, value, tone, onClick, hint }) => {
  const cls = `text-left w-full rounded-md border p-3.5 sm:p-4 ${tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-[#e3d8c4] bg-[#fffdf8]'}`;
  const body = (<>
    <p className="text-[13px] text-stone-600 leading-snug">{label}</p>
    <p className="mt-1 flex items-baseline gap-1 text-2xl font-semibold text-stone-900 tabular-nums break-words">{value}</p>
    {(hint || onClick) && <p className={`mt-0.5 text-xs ${tone === 'warn' ? 'text-amber-900' : 'text-stone-500'} flex items-center gap-0.5`}>{hint || 'Open'}{onClick && <span className="material-symbols-outlined text-sm" aria-hidden="true">chevron_right</span>}</p>}
  </>);
  return onClick
    ? <button onClick={onClick} className={`${cls} hover:border-stone-400 transition-colors`}>{body}</button>
    : <div className={cls}>{body}</div>;
};

type Tone = 'primary' | 'danger' | 'plain';
const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }> = ({ tone = 'plain', className = '', ...p }) => (
  <button {...p} className={`inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-40 ${tone === 'primary' ? 'bg-stone-900 text-[#fbf7ef] hover:bg-stone-800' : tone === 'danger' ? 'bg-red-700 text-white hover:bg-red-800' : 'border border-stone-300 bg-white/70 text-stone-800 hover:bg-white hover:border-stone-400'} ${className}`} />
);

/** A quiet line for results, and an amber one for anything that needs attention. */
const Notice: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn'; alert?: boolean }> = ({ children, tone = 'info', alert }) => (
  <p role={alert ? 'alert' : 'status'} className={`text-sm rounded-md px-3.5 py-2.5 border ${tone === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-950' : 'bg-[#f4eee2] border-[#e3d8c4] text-stone-800'}`}>{children}</p>
);

const Loading: React.FC<{ label?: string }> = ({ label = 'Fetching the records' }) => <PressingLoader label={label} className="py-10" />;

/** A warm empty state: the glyph of the place, and one line of reassurance. */
const Quiet: React.FC<{ glyph: GlyphName; children: React.ReactNode; sub?: string }> = ({ glyph, children, sub }) => (
  <div className="py-8 flex flex-col items-center text-center">
    <Glyph name={glyph} size={36} strokeWidth={1.2} className="text-[#b9a98a] mb-2" />
    <p className="font-display italic text-[17px] text-stone-700">{children}</p>
    {sub && <p className="text-sm text-stone-500 mt-1 max-w-sm">{sub}</p>}
  </div>
);

/** The app's inline confirmation: the question in place, a way back, and the action named again. */
const Ask: React.FC<{
  question: React.ReactNode; yes: string; no?: string; tone?: 'primary' | 'danger'; busy?: boolean;
  onYes: () => void; onNo: () => void;
  field?: { label: string; placeholder?: string; value: string; set: (v: string) => void };
}> = ({ question, yes, no = 'Cancel', tone = 'primary', busy, onYes, onNo, field }) => (
  <div role="alertdialog" aria-label={typeof question === 'string' ? question : yes} className="basis-full w-full mt-2 rounded-md border border-[#e3d8c4] bg-[#f6f0e3] p-3 flex flex-wrap items-center gap-2">
    <p className="text-sm text-stone-800 flex-1 min-w-[12rem]">{question}</p>
    {field && (
      <label className="basis-full text-sm text-stone-700">{field.label}
        <input autoFocus value={field.value} onChange={e => field.set(e.target.value)} placeholder={field.placeholder} className={INPUT} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onYes(); } }} />
      </label>
    )}
    <div className="flex flex-wrap justify-end gap-2 ml-auto">
      <Btn type="button" onClick={onNo} autoFocus={!field}>{no}</Btn>
      <Btn type="button" tone={tone} onClick={onYes} disabled={busy}>{yes}</Btn>
    </div>
  </div>
);

/** A button that asks first, inline. With `field`, the answer carries a short note. */
const AskButton: React.FC<{
  label: React.ReactNode; tone?: Tone; question: React.ReactNode; yes: string; no?: string; yesTone?: 'primary' | 'danger';
  field?: { label: string; placeholder?: string }; onYes: (text: string) => void; disabled?: boolean; className?: string;
}> = ({ label, tone, question, yes, no, yesTone, field, onYes, disabled, className }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) return <Btn tone={tone} disabled={disabled} className={className} onClick={() => { setText(''); setOpen(true); }}>{label}</Btn>;
  return (
    <Ask question={question} yes={yes} no={no} tone={yesTone || (tone === 'danger' ? 'danger' : 'primary')}
      onNo={() => setOpen(false)} onYes={() => { setOpen(false); onYes(text); }}
      field={field ? { ...field, value: text, set: setText } : undefined} />
  );
};

/** A row of tabs drawn as index tabs on a drawer. */
function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: [T, string][]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
      {items.map(([id, text]) => (
        <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}
          className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm transition-colors ${value === id ? 'bg-stone-900 text-[#fbf7ef] font-medium' : 'bg-[#f1e9d9] text-stone-700 hover:bg-[#e9dfcb]'}`}>{text}</button>
      ))}
    </div>
  );
}

const Json: React.FC<{ value: any }> = ({ value }) => (
  <pre className="text-xs bg-[#f8f4ea] border border-[#e8dfcd] rounded-md p-3 overflow-auto max-h-96 whitespace-pre-wrap break-all text-stone-800">{JSON.stringify(value, null, 2)}</pre>
);
const Bars: React.FC<{ values: number[]; label: string }> = ({ values, label }) => {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div role="img" aria-label={label} className="flex items-end gap-[3px] h-28 border-b border-stone-300">
        {values.map((v, i) => <div key={i} title={`${v}`} className="flex-1 bg-theme-accent/70 rounded-t-[2px]" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />)}
      </div>
      <div className="flex justify-between text-[11px] text-stone-500 mt-1 tabular-nums"><span>24 h ago</span><span>peak {max.toLocaleString()}</span><span>now</span></div>
    </div>
  );
};
const TH = 'py-1.5 pr-3 font-medium text-stone-500 whitespace-nowrap';
const linkCls = 'underline decoration-stone-400 underline-offset-2 hover:decoration-stone-800 text-stone-800';

// ---------------------------------------------------------------------------- sections

const Overview: React.FC<{ go: (s: Section) => void }> = ({ go }) => {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api('/overview').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  if (err) return <Notice tone="warn" alert>{err}</Notice>;
  if (!d) return <Loading label="Reading today's figures" />;
  const pctCeiling = d.ceiling ? Math.round((d.tokensToday / d.ceiling) * 100) : 0;
  const Row: React.FC<{ k: string; v: any }> = ({ k, v }) => <li className={`flex justify-between gap-3 border-b ${RULE} py-1.5`}><span className="truncate">{k}</span><span className="tabular-nums">{String(v)}</span></li>;
  return (
    <div className="space-y-5">
      {!d.store.ok && <Notice tone="warn" alert><b>The server can't reach the database</b> ({d.store.error}). Allowances fail closed, so AI features are refusing requests until this is fixed.</Notice>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="AI calls, last 24 h" value={n(d.last24h.calls)} />
        <Stat label="Errors, last 24 h" value={n(d.last24h.errors)} tone={d.last24h.errors > d.last24h.calls * 0.05 ? 'warn' : undefined} />
        <Stat label="Explorers using AI, 24 h" value={n(d.last24h.activeExplorers)} />
        <Stat label="Sightings shared today" value={n(d.postsToday)} />
        <Stat label="Tokens today" value={n(d.tokensToday)} hint={d.ceiling ? `${pctCeiling}% of the daily ceiling` : 'No daily ceiling set'} tone={pctCeiling > 80 ? 'warn' : undefined} />
        <Stat label="Waiting for review" value={d.queues.review} onClick={() => go('review')} hint={d.queues.review ? 'Open the review desk' : 'Nothing waiting'} tone={d.queues.review ? 'warn' : undefined} />
        <Stat label="Reported sightings" value={d.queues.reported} onClick={() => go('review')} hint={d.queues.reported ? 'See the reports' : 'No reports'} tone={d.queues.reported ? 'warn' : undefined} />
        <Stat label="Reported letters" value={d.queues.letters} onClick={() => go('letters')} hint={d.queues.letters ? 'See the reports' : 'No reports'} tone={d.queues.letters ? 'warn' : undefined} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="AI calls per hour, last 24 hours"><Bars values={d.last24h.hourly} label="AI calls per hour over the last day" /></Card>
        <Card title="By task, and anything unusual">
          <div className="grid grid-cols-2 gap-4 text-sm text-stone-800">
            <div><p className="text-xs text-stone-500 mb-1">By task</p><ul>{Object.entries(d.last24h.byTask).map(([k, v]) => <Row key={k} k={k} v={v} />)}</ul></div>
            <div><p className="text-xs text-stone-500 mb-1">Flagged</p><ul>{Object.keys(d.last24h.flagged).length === 0 ? <li className="py-1.5 font-display italic text-stone-500">Nothing unusual</li> : Object.entries(d.last24h.flagged).map(([k, v]) => <Row key={k} k={k} v={v} />)}</ul></div>
          </div>
        </Card>
      </div>
      <Card title="As things stand">
        <div className="flex flex-wrap gap-2 text-sm">
          {SWITCHES.map(([k, label]) => (
            <span key={k} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${d.flags[k] ? 'border-stone-300 bg-white text-stone-800' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
              <span aria-hidden="true" className={`w-2 h-2 rounded-full ${d.flags[k] ? 'bg-stone-700' : 'border border-amber-700'}`} />{label}: {d.flags[k] ? 'on' : 'off'}
            </span>
          ))}
          <span className="px-2.5 py-1 rounded-full bg-[#f1e9d9] text-stone-800 tabular-nums">Daily: {d.flags.allowances.postsPerDay} sightings · {d.flags.allowances.liveMinutesPerDay} live min · {d.flags.allowances.identificationsPerDay} identifications</span>
          <span className="px-2.5 py-1 rounded-full bg-[#f1e9d9] text-stone-800 tabular-nums">Policy v{d.policy}</span>
        </div>
      </Card>
    </div>
  );
};

const Controls: React.FC = () => {
  const [flags, setFlags] = useState<any>(null);
  const [caps, setCaps] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [f, s] = await Promise.all([api('/flags'), api('/settings')]);
    setFlags(f); setCaps(s.settings.caps);
  }, []);
  useEffect(() => { load().catch(e => setMsg(e.message)); }, [load]);
  if (!flags || !caps) return msg ? <Notice tone="warn" alert>{msg}</Notice> : <Loading label="Reading the switches" />;

  const toggle = async (k: string) => {
    setAsking(null);
    try { setFlags(await api('/flags', { method: 'PUT', body: { [k]: !flags[k] } })); setMsg('Saved. Takes effect everywhere within 30 seconds.'); } catch (e: any) { setMsg(e.message); }
  };
  const saveAllowances = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const allowances = { postsPerDay: Number(f.get('posts')), liveMinutesPerDay: Number(f.get('live')), identificationsPerDay: Number(f.get('ids')) };
    try { setFlags(await api('/flags', { method: 'PUT', body: { allowances } })); setMsg('Allowances saved. They apply to every account, with no exceptions.'); } catch (err: any) { setMsg(err.message); }
  };
  const saveCaps = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next: any = {};
    for (const k of Object.keys(caps)) next[k] = Number(f.get(k));
    try { const s = await api('/settings', { method: 'PUT', body: { caps: next } }); setCaps(s.caps); setMsg('Limits saved.'); } catch (err: any) { setMsg(err.message); }
  };
  const CAPS: Record<string, string> = {
    otherAiCallsPerDay: 'Other AI calls per account per day (descriptions, curation, summaries)', maxOutputTokens: 'Longest AI answer (tokens)',
    thinkingBudget: 'Thinking budget per answer (tokens)', dailyTokenCeiling: 'Daily token ceiling for everyone (0 = none)',
    liveSessionsPerNetworkPerHour: 'Live sessions per network per hour', liveConcurrentPerNetwork: 'Live sessions open at once per network',
  };
  return (
    <div className="space-y-4">
      {msg && <Notice>{msg}</Notice>}
      <Card title="Daily allowance for every account">
        <form onSubmit={saveAllowances} className="grid sm:grid-cols-3 gap-3 items-end">
          <label className="text-sm text-stone-700">Sightings shared per day<input name="posts" type="number" min={0} max={100} defaultValue={flags.allowances.postsPerDay} className={`${INPUT} tabular-nums`} /></label>
          <label className="text-sm text-stone-700">Live guide minutes per day<input name="live" type="number" min={0} max={240} defaultValue={flags.allowances.liveMinutesPerDay} className={`${INPUT} tabular-nums`} /></label>
          <label className="text-sm text-stone-700">AI identifications per day<input name="ids" type="number" min={0} max={500} defaultValue={flags.allowances.identificationsPerDay} className={`${INPUT} tabular-nums`} /></label>
          <Btn tone="primary" type="submit" className="sm:col-span-3 justify-self-start">Save allowances</Btn>
        </form>
        <p className="text-xs text-stone-500 mt-3">No exceptions. Counted on the server per account per day (UTC). An identification is one photo, sound or clip the guide names.</p>
      </Card>
      <Card title="Switches for everyone">
        <ul className={`divide-y ${DIVIDE}`}>
          {SWITCHES.map(([k, label]) => (
            <li key={k} className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-stone-800">{label}<span className={`ml-2 text-xs ${flags[k] ? 'text-stone-500' : 'text-amber-800 font-medium'}`}>{flags[k] ? 'on' : 'off'}</span></span>
                <button role="switch" aria-checked={!!flags[k]} aria-label={label} onClick={() => setAsking(asking === k ? null : k)} className={`w-12 h-7 shrink-0 rounded-full relative transition-colors ${flags[k] ? 'bg-theme-accent' : 'bg-stone-300'}`}>
                  <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${flags[k] ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {asking === k && <Ask question={`Turn ${label.toLowerCase()} ${flags[k] ? 'off' : 'on'} for everyone?`} yes={flags[k] ? 'Turn off' : 'Turn on'} onNo={() => setAsking(null)} onYes={() => toggle(k)} />}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Limits and spending">
        <form onSubmit={saveCaps} className="grid sm:grid-cols-2 gap-3">
          {Object.keys(CAPS).map(k => (
            <label key={k} className="text-sm text-stone-700">{CAPS[k]}<input name={k} type="number" defaultValue={caps[k]} className={`${INPUT} tabular-nums`} /></label>
          ))}
          <Btn tone="primary" type="submit" className="justify-self-start">Save limits</Btn>
        </form>
      </Card>
    </div>
  );
};

const PROMPT_LABELS: Record<string, string> = {
  live: 'Live guide', identify: 'Identification', describe: 'Research descriptors', curate: 'Feed curation', synthesize: 'Multi-capture summary', moderate: 'Photo check before sharing',
};
const GUIDANCE_LABELS: Record<string, string> = {
  people: 'Person in frame', faces: 'Face visible', plates: 'Number plate visible', screen: 'Screen or document', notNature: 'No living subject',
  sensitive: 'Protected species (location hidden)', caption: 'Links or promotions in text', safety: 'Unsafe edibility or medicine claims',
};

const AiGovernance: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'prompts' | 'policy' | 'models' | 'guidance' | 'history'>('prompts');
  const [which, setWhich] = useState('identify');
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<any[] | null>(null);
  const [pending, setPending] = useState<{ patch: any; what: string } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const load = useCallback(() => api('/settings').then(setData).catch(e => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data) setDraft(tab === 'policy' ? data.settings.policy : data.settings.prompts[which] || ''); }, [data, which, tab]);
  useEffect(() => { if (tab === 'history') api('/history/settings').then(r => setHistory(r.items)).catch(e => setMsg(e.message)); }, [tab]);
  useEffect(() => { setPending(null); setRestoring(null); }, [tab, which]);
  if (!data) return msg ? <Notice tone="warn" alert>{msg}</Notice> : <Loading label="Reading the guide's instructions" />;
  const s = data.settings;

  const ask = (patch: any, what: string) => setPending({ patch, what });
  const save = async () => {
    if (!pending) return;
    const { patch, what } = pending; setPending(null);
    try { await api('/settings', { method: 'PUT', body: patch }); await load(); setMsg(`${what[0].toUpperCase() + what.slice(1)} saved. The previous version is in History.`); } catch (e: any) { setMsg(e.message); }
  };
  const rollback = async (id: string) => {
    setRestoring(null);
    try { await api(`/history/settings/${id}/rollback`, { method: 'POST' }); await load(); setMsg('Restored.'); setTab('prompts'); } catch (e: any) { setMsg(e.message); }
  };
  const confirmBar = pending && <Ask question={`Save the ${pending.what}? It applies to every AI call within 30 seconds.`} yes="Save" onNo={() => setPending(null)} onYes={save} />;
  const editor = 'w-full font-mono text-xs leading-relaxed bg-[#f8f4ea] border border-[#e3d8c4] rounded-md p-3 text-stone-900';

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600 max-w-3xl">These control how the AI behaves for every explorer. The app cannot change them: the server applies them to each call, adds the platform policy after the prompt, and passes anything explorers write as information, never as instructions.</p>
      <Tabs<typeof tab> label="AI governance" value={tab} onChange={setTab} items={[['prompts', 'Prompts'], ['policy', 'Platform policy'], ['models', 'Models'], ['guidance', 'Held-back messages'], ['history', 'History']]} />
      {msg && <Notice>{msg}</Notice>}
      {tab === 'prompts' && (
        <Card>
          <label className="block text-sm text-stone-700 mb-3 sm:hidden">Prompt
            <select value={which} onChange={e => setWhich(e.target.value)} className={INPUT}>{Object.keys(s.prompts).map(k => <option key={k} value={k}>{PROMPT_LABELS[k] || k}</option>)}</select>
          </label>
          <div className="hidden sm:flex gap-2 flex-wrap mb-3">
            {Object.keys(s.prompts).map(k => <button key={k} onClick={() => setWhich(k)} aria-pressed={which === k} className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${which === k ? 'bg-[#f1e9d9] border-stone-500 text-stone-900 font-medium' : 'border-stone-300 text-stone-700 hover:bg-white'}`}>{PROMPT_LABELS[k] || k}</button>)}
          </div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={18} aria-label={`${PROMPT_LABELS[which]} prompt`} className={editor} />
          <div className="flex gap-2 mt-3 flex-wrap items-center">
            <Btn tone="primary" onClick={() => ask({ prompts: { [which]: draft } }, `${PROMPT_LABELS[which]} prompt`)} disabled={draft === s.prompts[which]}>Save prompt</Btn>
            <Btn onClick={() => setDraft(data.defaults.prompts[which])}>Load the original</Btn>
            <span className="text-xs text-stone-500 tabular-nums">{draft.length.toLocaleString()} characters</span>
            {confirmBar}
          </div>
        </Card>
      )}
      {tab === 'policy' && (
        <Card title="Platform policy">
          <p className="text-sm text-stone-600 -mt-1 mb-3">Added after every prompt. Where they disagree, the policy wins.</p>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={16} aria-label="Platform policy" className={editor} />
          <div className="flex gap-2 mt-3 flex-wrap">
            <Btn tone="primary" onClick={() => ask({ policy: draft }, 'platform policy')} disabled={draft === s.policy}>Save policy</Btn>
            <Btn onClick={() => setDraft(data.defaults.policy)}>Load the original</Btn>
            {confirmBar}
          </div>
        </Card>
      )}
      {tab === 'models' && (
        <Card title="Models">
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const models: any = {}; Object.keys(s.models).forEach(k => { models[k] = String(f.get(k)).trim(); }); ask({ models }, 'models'); }} className="grid sm:grid-cols-2 gap-3">
            {Object.keys(s.models).map(k => <label key={k} className="text-sm text-stone-700">{PROMPT_LABELS[k] || k}<input name={k} defaultValue={s.models[k]} className={`${INPUT} font-mono text-xs`} /></label>)}
            <div className="sm:col-span-2 flex flex-wrap"><Btn tone="primary" type="submit">Save models</Btn>{confirmBar}</div>
          </form>
          <p className="text-xs text-stone-500 mt-3">Only Gemini model names are accepted. The live guide needs a native-audio model (models/…).</p>
        </Card>
      )}
      {tab === 'guidance' && (
        <Card title="What explorers see when a capture is held back">
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const guidance: any = {}; Object.keys(s.guidance).forEach(k => { guidance[k] = String(f.get(k)); }); ask({ guidance }, 'messages'); }} className="space-y-3">
            {Object.keys(s.guidance).map(k => <label key={k} className="block text-sm text-stone-700">{GUIDANCE_LABELS[k] || k}<textarea name={k} defaultValue={s.guidance[k]} rows={2} maxLength={400} className={INPUT} /></label>)}
            <div className="flex flex-wrap"><Btn tone="primary" type="submit">Save messages</Btn>{confirmBar}</div>
          </form>
        </Card>
      )}
      {tab === 'history' && (
        <Card title="Changes, newest first">
          {!history ? <Loading label="Turning back the pages" /> : history.length === 0 ? <Quiet glyph="feather">No changes yet. Everything is as first written.</Quiet> : (
            <ul className={`divide-y ${DIVIDE}`}>
              {history.map(h => (
                <li key={h.id} className="py-3 flex flex-wrap sm:items-center gap-2 justify-between">
                  <div className="text-sm text-stone-800 min-w-0 break-words"><span className="font-medium tabular-nums">{when(h.at)}</span> · {h.email || h.by} · changed {Object.keys(h.patch || {}).join(', ')}</div>
                  {restoring === h.id
                    ? <Ask question="Restore the settings as they were before this change?" yes="Restore" onNo={() => setRestoring(null)} onYes={() => rollback(h.id)} />
                    : <Btn onClick={() => setRestoring(h.id)}>Restore what it replaced</Btn>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
};

const Monitor: React.FC<{ openUser: (uid: string) => void }> = ({ openUser }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const [task, setTask] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const [view, setView] = useState<'log' | 'usage' | 'quality'>('log');
  const [msg, setMsg] = useState('');
  const load = useCallback(async (more = false) => {
    const q = new URLSearchParams({ limit: '100' });
    if (task) q.set('task', task);
    if (flagged) q.set('flagged', '1');
    if (more && before) q.set('before', String(before));
    try { const r = await api(`/ai-log?${q}`); setRows(p => (more ? [...p, ...r.items] : r.items)); setBefore(r.before); } catch (e: any) { setMsg(e.message); } finally { setLoaded(true); }
  }, [task, flagged, before]);
  useEffect(() => { if (view === 'log') load(false); /* eslint-disable-next-line */ }, [task, flagged, view]);
  useEffect(() => { if (view === 'usage') api('/usage').then(setUsage).catch(e => setMsg(e.message)); }, [view]);
  const loadQuality = useCallback(() => api('/ai-quality?limit=1000').then(r => r.items), []);
  return (
    <div className="space-y-4">
      <Tabs<typeof view> label="AI monitor" value={view} onChange={setView} items={[['log', 'Every AI call'], ['usage', "Today's usage by explorer"], ['quality', 'Identification quality']]} />
      {msg && <Notice tone="warn">{msg}</Notice>}
      {view === 'log' && (
        <Card actions={<div className="flex flex-wrap gap-2 items-center text-sm w-full sm:w-auto">
          <select value={task} onChange={e => setTask(e.target.value)} aria-label="Task" className="bg-white border border-stone-300 rounded-lg px-2 py-1.5 text-sm"><option value="">All tasks</option>{['ng-identify', 'ng-describe', 'ng-curate', 'ng-synthesize', 'live', 'moderate', 'blocked'].map(t => <option key={t}>{t}</option>)}</select>
          <label className="flex items-center gap-1.5 text-stone-700"><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} className="accent-stone-800" />Only unusual</label>
          <Btn onClick={() => load(false)} className="ml-auto sm:ml-0 min-h-[34px] px-3">Refresh</Btn>
        </div>}>
          <p className="text-xs text-stone-500 mb-2">One line per call: who, what, how big, how long, and anything unusual (shaded). Content is never stored. Kept 30 days.</p>
          {!loaded ? <Loading /> : rows.length === 0 ? <Quiet glyph="guide">No calls to show here yet.</Quiet> : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="w-full text-xs text-stone-800">
                <thead><tr className="text-left"><th className={TH}>When</th><th className={TH}>Explorer</th><th className={TH}>Task</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Time (ms)</th><th className={`${TH} text-right`}>Tokens</th><th className={TH}>Ended</th><th className={TH}>Flags</th></tr></thead>
                <tbody>
                  {rows.map(r => {
                    const odd = r.status >= 400 || r.blockReason || (r.finishReason && r.finishReason !== 'STOP') || Object.values(r.flags || {}).some(Boolean);
                    return (
                      <tr key={r.id} className={`border-t ${RULE} ${odd ? 'bg-amber-50' : ''}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{when(r.at)}</td>
                        <td className="pr-3 whitespace-nowrap"><button onClick={() => openUser(r.uid)} className={`${linkCls} font-mono`}>{String(r.uid || '').slice(0, 8)}</button>{r.anon ? ' (guest)' : ''}</td>
                        <td className="pr-3 whitespace-nowrap">{r.task}</td><td className="pr-3 tabular-nums">{r.status}</td><td className="pr-3 tabular-nums text-right">{r.ms ?? ''}</td>
                        <td className="pr-3 tabular-nums text-right">{r.totalTokens ?? ''}</td><td className="pr-3">{r.blockReason || r.finishReason || ''}</td>
                        <td className="text-amber-900">{Object.entries(r.flags || {}).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k}: ${v}`)).join(', ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {before && <Btn className="mt-3" onClick={() => load(true)}>Load older calls</Btn>}
        </Card>
      )}
      {view === 'usage' && (
        !usage ? <Loading label="Counting today's usage" /> : (
          <Card title={`${usage.explorers} explorers used something today (${usage.day})`}>
            {usage.items.length === 0 ? <Quiet glyph="tracks">No one has used the guide yet today.</Quiet> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-stone-800">
                  <thead><tr className="text-left"><th className={TH}>Explorer</th><th className={`${TH} text-right`}>Identifications</th><th className={`${TH} text-right`}>Other AI</th><th className={`${TH} text-right`}>Live min</th><th className={`${TH} text-right`}>Shared</th></tr></thead>
                  <tbody>{usage.items.map((u: any) => (
                    <tr key={u.id} className={`border-t ${RULE} tabular-nums`}><td className="py-1.5 pr-3"><button onClick={() => openUser(u.uid)} className={`${linkCls} font-mono text-xs`}>{String(u.uid).slice(0, 10)}</button></td><td className="pr-3 text-right">{u.identify || 0}</td><td className="pr-3 text-right">{u.other || 0}</td><td className="pr-3 text-right">{Math.ceil((u.liveMs || 0) / 60000)}</td><td className="pr-3 text-right">{u.posts || 0}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        )
      )}
      {view === 'quality' && <AiQualityPanel load={loadQuality} />}
    </div>
  );
};

const Review: React.FC<{ openUser: (uid: string) => void }> = ({ openUser }) => {
  const [queue, setQueue] = useState<any[] | null>(null);
  const [reported, setReported] = useState<any[] | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    api('/review').then(r => setQueue(r.items)).catch(e => setMsg(e.message));
    api('/reported').then(r => setReported(r.items)).catch(e => setMsg(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (id: string, action: 'approve' | 'reject', note = '') => {
    try { await api(`/review/${id}`, { method: 'POST', body: { action, note } }); setMsg(action === 'approve' ? 'Approved.' : 'Kept in their journal.'); load(); } catch (e: any) { setMsg(e.message); }
  };
  const act = async (id: string, action: string) => {
    try { await api(`/posts/${id}`, { method: 'POST', body: { action } }); load(); } catch (e: any) { setMsg(e.message); }
  };
  const noteField = { label: 'A short note for the explorer (optional)', placeholder: 'For example: please crop out the car number plate' };
  return (
    <div className="space-y-4">
      {msg && <Notice>{msg}</Notice>}
      <Card title={queue && queue.length ? `Waiting for a decision (${queue.length})` : 'Waiting for a decision'} actions={<Btn onClick={load}>Refresh</Btn>}>
        {!queue ? <Loading label="Gathering the review pile" /> : queue.length === 0 ? <Quiet glyph="stamp">Nothing waiting for review. The field is quiet.</Quiet> : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {queue.map(q => {
              const [yes, no] = q.kind === 'comment' ? ['Show the note', 'Keep it hidden'] : q.kind === 'unchecked' ? ['Looks fine', 'Hide it from the feed'] : ['Approve', 'Keep it in their journal'];
              return (
                <li key={q.id} className="rounded-[3px] p-2 bg-[#fbf7ef] shadow-[0_1px_2px_rgba(60,40,20,0.12),0_6px_18px_-10px_rgba(60,40,20,0.25)] min-w-0">
                  <div className="h-full rounded-[2px] border border-[#d8ccb6] flex flex-col">
                    {q.thumb && <img src={q.thumb} alt="" className="m-2 mb-0 aspect-[4/3] object-cover bg-[#efe7d6]" />}
                    <div className="p-3 space-y-2 text-sm text-stone-800 flex-1 flex flex-col">
                      <p className="font-display text-[17px] leading-snug text-stone-900">{KIND_LABEL[q.kind || 'privacy'] || 'Review'}</p>
                      <p><span className="text-stone-500">Why:</span> {(q.reasons || []).map((r: string) => REASON_LABEL[r] || r).join(', ') || 'not checked'}{q.requestedByExplorer ? ' · explorer asked for review' : ''}</p>
                      {q.kind === 'comment' && q.text && <p className="bg-white/70 border border-[#e8dfcd] rounded p-2 break-words font-display italic">“{q.text}”</p>}
                      {q.note && <p className="text-stone-600 font-display italic">“{q.note}”</p>}
                      <p className="text-xs text-stone-500 tabular-nums">{when(q.createdAt)} · {q.userId ? <button onClick={() => openUser(q.userId)} className={linkCls}>explorer</button> : 'explorer'}{q.kind !== 'comment' ? ` · ${q.published ? 'already in the feed' : `wants ${q.requestedFeed ? 'feed' : 'journal'}`}` : ''}</p>
                      <div className="flex gap-2 flex-wrap mt-auto pt-1">
                        <Btn tone="primary" onClick={() => decide(q.id, 'approve')}>{yes}</Btn>
                        <AskButton label={no} question={`${no}?`} yes={no} field={noteField} onYes={note => decide(q.id, 'reject', note)} />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <ReviewWords />
      <Card title="Reported by explorers">
        {!reported ? <Loading label="Gathering reports" /> : reported.length === 0 ? <Quiet glyph="binoculars">No reports from explorers. All is well in the feed.</Quiet> : (
          <ul className="space-y-3">
            {reported.map(p => (
              <li key={p.id} className="border border-[#e3d8c4] bg-white/60 rounded-md p-3 flex gap-3 min-w-0">
                {(p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl) && <img src={p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl} alt="" className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded object-cover bg-[#efe7d6]" />}
                <div className="flex-1 min-w-0 text-sm text-stone-800 space-y-1 flex flex-wrap content-start">
                  <p className="basis-full"><span className="font-display italic text-[17px] text-stone-900">{p.labels?.[0] || 'Sighting'}</span> <span className="text-stone-500">by</span> <button onClick={() => openUser(p.userId)} className={linkCls}>{p.userName}</button></p>
                  {p.caption && <p className="basis-full text-stone-700 break-words">{p.caption}</p>}
                  <p className="basis-full text-xs text-amber-900">{(p.reportReasons || []).map((r: any) => `${r.reason}${r.details ? ` (${r.details})` : ''}`).join(' · ')}</p>
                  <div className="basis-full flex gap-2 flex-wrap pt-1">
                    <Btn onClick={() => act(p.id, 'dismiss')}>Dismiss the report</Btn>
                    <Btn onClick={() => act(p.id, 'hide')}>Hide from the feed</Btn>
                    <AskButton tone="danger" label="Delete" question="Delete this sighting permanently? This can't be undone." yes="Delete for good" no="Keep it" onYes={() => act(p.id, 'delete')} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

/** Extra words that send a sighting or field note to review (added to the built-in list). */
const ReviewWords: React.FC = () => {
  const [words, setWords] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api('/settings').then(s => setWords((s.settings.moderationWords || []).join(', '))).catch(e => setMsg(e.message)); }, []);
  const save = async () => {
    const list = (words || '').split(/[,\n]/).map(w => w.trim()).filter(Boolean);
    try { const s = await api('/settings', { method: 'PUT', body: { moderationWords: list } }); setWords((s.moderationWords || []).join(', ')); setMsg('Saved. New sightings and field notes are checked against these within a few minutes.'); } catch (e: any) { setMsg(e.message); }
  };
  return (
    <Card title="Words that send a sighting to review">
      <p className="text-sm text-stone-600 mb-2">A built-in list already covers strong abuse, slurs and sexual content, plus spam patterns. Add local words here, separated by commas. Whole words only, any case. Nothing is rejected: matching sightings and field notes wait here for you.</p>
      {words === null ? (msg ? <Notice tone="warn">{msg}</Notice> : <Loading label="Reading the word list" />) : (<>
        <textarea value={words} onChange={e => setWords(e.target.value)} rows={3} aria-label="Review words" className={INPUT} />
        <div className="flex flex-wrap items-center gap-3 mt-2"><Btn tone="primary" onClick={save}>Save words</Btn>{msg && <span role="status" className="text-sm text-stone-600">{msg}</span>}</div>
      </>)}
    </Card>
  );
};

/** Feature flags and A/B tests (config/flags). The app buckets explorers by a stable hash. */
const Experiments: React.FC = () => {
  const [flags, setFlags] = useState<Record<string, any> | null>(null);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const load = useCallback(() => api('/experiments').then(r => setFlags(r.flags || {})).catch(e => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!flags) return msg ? <Notice tone="warn" alert>{msg}</Notice> : <Loading label="Reading the flags" />;
  const set = (k: string, patch: any) => setFlags(f => ({ ...f!, [k]: { ...f![k], ...patch } }));
  const remove = (k: string) => setFlags(f => { const n = { ...f! }; delete n[k]; return n; });
  const save = async () => {
    try { const r = await api('/experiments', { method: 'PUT', body: { flags } }); setFlags(r.flags); setMsg('Saved. Open apps pick this up within seconds.'); } catch (e: any) { setMsg(e.message); }
  };
  const variantsText = (v?: { name: string; weight: number }[]) => (v || []).map(x => `${x.name}:${x.weight}`).join(', ');
  const parseVariants = (t: string) => {
    const list = t.split(',').map(x => x.trim()).filter(Boolean).map(x => { const [n, w] = x.split(':'); return { name: n.trim(), weight: Number(w ?? 1) }; });
    return list.length ? list : undefined;
  };
  return (
    <div className="space-y-4">
      {msg && <Notice>{msg}</Notice>}
      <Card title="Flags and experiments" actions={<Btn tone="primary" onClick={save}>Save all flags</Btn>}>
        <p className="text-sm text-stone-600 mb-3">Rollout is the share of explorers who get the flag (0 to 100). With variants (for example <span className="font-mono">control:50, warm:50</span>) those explorers are split by weight. Each explorer always lands in the same group. The first time a flag is seen, the app records an <span className="font-mono">experiment_exposure</span> event (for explorers who allow analytics). Changes here are kept only when you save.</p>
        {Object.keys(flags).length === 0 && <Quiet glyph="compass" sub="Every flag is off until it is added here.">No flags yet.</Quiet>}
        <ul className="space-y-3">
          {Object.entries(flags).map(([k, f]) => (
            <li key={k} className="border border-[#e3d8c4] bg-white/60 rounded-md p-3 flex flex-wrap gap-2 items-start">
              <div className="space-y-2 flex-1 min-w-0">
                <p className="font-mono text-sm font-semibold text-stone-900 break-all">{k}</p>
                <input value={f.description || ''} onChange={e => set(k, { description: e.target.value || undefined })} placeholder="What it changes" aria-label={`Description of ${k}`} className={`${INPUT} mt-0`} />
                <div className="flex flex-wrap items-center gap-3 text-sm text-stone-700">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled === true} onChange={e => set(k, { enabled: e.target.checked })} className="accent-stone-800 w-4 h-4" /> On</label>
                  <label className="flex items-center gap-2">Rollout <input type="number" min={0} max={100} value={f.rollout ?? 0} onChange={e => set(k, { rollout: Math.max(0, Math.min(100, Number(e.target.value))) })} className="w-20 bg-white border border-stone-300 rounded-lg px-2 py-1 tabular-nums" />%</label>
                  <label className="flex items-center gap-2 flex-1 min-w-[200px]">Variants <input defaultValue={variantsText(f.variants)} onBlur={e => set(k, { variants: parseVariants(e.target.value) })} placeholder="none (simple on/off)" className="flex-1 min-w-0 bg-white border border-stone-300 rounded-lg px-2 py-1 font-mono text-xs" /></label>
                </div>
              </div>
              <AskButton tone="danger" label="Remove" question={`Remove ${k}? Everyone falls back to the default.`} yes="Remove" no="Keep it" onYes={() => remove(k)} />
            </li>
          ))}
        </ul>
        <form onSubmit={e => { e.preventDefault(); const k = name.trim(); if (!/^[a-z][a-z0-9_]{1,39}$/.test(k)) { setMsg('Flag names are lowercase letters, digits and underscores.'); return; } setFlags(f => ({ ...f!, [k]: { enabled: false, rollout: 0 } })); setName(''); }} className="flex gap-2 mt-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="new_flag_name" aria-label="New flag name" className={`${INPUT} mt-0 font-mono flex-1 min-w-0`} />
          <Btn type="submit">Add flag</Btn>
        </form>
      </Card>
    </div>
  );
};

/** The favicon / home-screen mark: style, colours, or an uploaded image, with a live preview. */
const Branding: React.FC = () => {
  const [b, setB] = useState<BrandingConfig | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/branding').then(r => setB(r.branding)).catch(e => setMsg(e.message)); }, []);
  if (!b) return msg ? <Notice tone="warn" alert>{msg}</Notice> : <Loading label="Reading the branding" />;
  const set = (patch: Partial<BrandingConfig>) => setB(x => ({ ...x!, ...patch }));
  const now = getDailyTheme();
  const previews = [now, ...NATURALIST_THEMES.filter(t => t.id !== now.id).slice(0, 5)];
  const src = (colors: any) => b.style === 'custom' && isSafeIcon(b.customIcon)
    ? b.customIcon!
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markSvg(resolveColors(colors, b), b.style === 'lens' ? 'lens' : 'sun'))}`;
  const upload = (file?: File | null) => {
    if (!file) return;
    if (!/^image\/(png|webp|jpeg)$/.test(file.type)) { setMsg('Choose a PNG, WebP or JPEG image.'); return; }
    const img = new Image();
    img.onload = () => {
      // Square it to 512 × 512 PNG so it is small, safe and sharp everywhere
      const cv = document.createElement('canvas'); cv.width = cv.height = 512;
      const ctx = cv.getContext('2d')!; const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
      let url = cv.toDataURL('image/png');
      if (url.length > 210_000) url = cv.toDataURL('image/webp', 0.85);
      if (url.length > 210_000) { setMsg('That image is too detailed to use as an icon. Try a simpler one.'); return; }
      set({ style: 'custom', customIcon: url }); setMsg('');
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };
  const save = async () => {
    setBusy(true);
    try { const r = await api('/branding', { method: 'PUT', body: { branding: b } }); setB(r.branding); setMsg('Saved. Open apps change their icon within seconds.'); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const fixed = b.fixed || { ground: '#2d4a22', ground2: '#3e6330', ink: '#ffffff' };
  const Choice: React.FC<{ on: boolean; onClick: () => void; title: string; sub: string; children?: React.ReactNode }> = ({ on, onClick, title, sub, children }) => (
    <button type="button" onClick={onClick} aria-pressed={on} className={`text-left p-3 rounded-lg border flex gap-3 items-center min-h-[64px] ${on ? 'border-theme-accent bg-theme-accent/5' : 'border-[#e3d8c4] bg-white/60 hover:bg-white'}`}>
      {children}<span><span className="block font-semibold text-stone-900 text-sm">{title}</span><span className="block text-xs text-stone-600">{sub}</span></span>
    </button>
  );
  const sample = (style: 'sun' | 'lens') => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markSvg(resolveColors(now.colors, { ...b, style }), style))}`;
  return (
    <div className="space-y-4">
      {msg && <Notice>{msg}</Notice>}
      <Card title="The mark" actions={<Btn tone="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save branding'}</Btn>}>
        <div className="grid sm:grid-cols-3 gap-2">
          <Choice on={b.style !== 'lens' && b.style !== 'custom'} onClick={() => set({ style: 'sun' })} title="The landing sun" sub="The sun from the landing page. Recommended."><img src={sample('sun')} alt="" className="w-10 h-10" /></Choice>
          <Choice on={b.style === 'lens'} onClick={() => set({ style: 'lens' })} title="Hand lens and fern" sub="A lens over an uncurling fiddlehead."><img src={sample('lens')} alt="" className="w-10 h-10" /></Choice>
          <label className={`text-left p-3 rounded-lg border flex gap-3 items-center min-h-[64px] cursor-pointer ${b.style === 'custom' ? 'border-theme-accent bg-theme-accent/5' : 'border-[#e3d8c4] bg-white/60 hover:bg-white'}`}>
            {b.style === 'custom' && isSafeIcon(b.customIcon) ? <img src={b.customIcon!} alt="" className="w-10 h-10 rounded-lg" /> : <Glyph name="plate" size={36} className="text-stone-400" />}
            <span><span className="block font-semibold text-stone-900 text-sm">Your own image</span><span className="block text-xs text-stone-600">PNG, WebP or JPEG, square works best. It does not change colour.</span></span>
            <input type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" onChange={e => upload(e.target.files?.[0])} />
          </label>
        </div>
      </Card>
      {b.style !== 'custom' && (
        <Card title="Colours">
          <div className="grid sm:grid-cols-2 gap-2">
            <Choice on={b.colorMode !== 'fixed'} onClick={() => set({ colorMode: 'naturalist' })} title="Follow the naturalist of the fortnight" sub="Changes every fifteen days with the theme. Recommended." />
            <Choice on={b.colorMode === 'fixed'} onClick={() => set({ colorMode: 'fixed', fixed })} title="Fixed colours" sub="The same colours all year." />
          </div>
          {b.colorMode === 'fixed' && (
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-stone-700">
              {([['ground', 'Background'], ['ground2', 'Background, second'], ['ink', 'Sun and drawing']] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">{label}
                  <input type="color" value={(fixed as any)[k]} onChange={e => set({ colorMode: 'fixed', fixed: { ...fixed, [k]: e.target.value } })} className="w-10 h-10 rounded border border-stone-300 bg-white" />
                </label>
              ))}
            </div>
          )}
        </Card>
      )}
      <Card title="Preview">
        <p className="text-sm text-stone-600 mb-3">How it looks in a browser tab (16 px), on a home screen and large, now and in coming fortnights.</p>
        <ul className="space-y-3">
          {previews.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3">
              <img src={src(t.colors)} alt="" width={64} height={64} className="rounded-[14px]" />
              <img src={src(t.colors)} alt="" width={32} height={32} className="rounded-[7px]" />
              <img src={src(t.colors)} alt="" width={16} height={16} />
              <span className="text-sm text-stone-700">{t.naturalist}{i === 0 ? ' (this fortnight)' : ''}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-stone-500 mt-3">Installed iOS and Android apps keep the icon they were built with; it is regenerated with <span className="font-mono">npm run assets:native</span> for the next store release.</p>
      </Card>
    </div>
  );
};

/** Exports and one-off maintenance jobs. */
const DataTools: React.FC = () => {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const exportDwc = async () => {
    setBusy('dwc'); setMsg('Building the archive. Large collections can take a minute…');
    try { const r = await download('/export/dwc.zip', 'naturegram-dwca.zip'); setMsg(`Darwin Core Archive downloaded: ${r.count ?? '?'} records (${r.skipped ?? 0} sightings left out: not public, under review, or no scientific name).`); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  };
  const backfill = async () => {
    setBusy('search'); let after: string | null = null; let processed = 0; let updated = 0;
    try {
      do {
        const r: any = await api('/backfill/search-tokens', { method: 'POST', body: { after, limit: 300 } });
        processed += r.processed; updated += r.updated; after = r.next;
        setMsg(`Search keys: ${processed} sightings checked, ${updated} updated…`);
      } while (after);
      setMsg(`Search keys done: ${processed} sightings checked, ${updated} updated.`);
    } catch (e: any) { setMsg(`Stopped after ${processed} sightings: ${e.message}. Run it again to carry on.`); } finally { setBusy(''); }
  };
  /**
   * "Give every video a poster": the backfillPosters Cloud Function (it has ffmpeg) fills stills,
   * blur-up previews, sizes and the sound-only mark on older sightings, a few per call. It resumes
   * from where it stopped (the cursor is kept on this device) and is safe to run again.
   */
  const POSTER_CURSOR = 'ng_admin_poster_cursor';
  const posters = async () => {
    setBusy('posters');
    let after: string | null = null;
    try { after = localStorage.getItem(POSTER_CURSOR); } catch { /* storage unavailable */ }
    const t = { processed: 0, updated: 0, posters: 0, soundOnly: 0, failed: 0 };
    try {
      const [{ getFunctions, httpsCallable }, { app }] = await Promise.all([import('firebase/functions'), import('../firebaseConfig')]);
      const call = httpsCallable<{ after: string | null; limit: number }, typeof t & { next: string | null }>(getFunctions(app, 'asia-east1'), 'backfillPosters', { timeout: 540_000 });
      do {
        const { data: r } = await call({ after, limit: 8 });
        (Object.keys(t) as (keyof typeof t)[]).forEach(k => { t[k] += r[k] || 0; });
        after = r.next;
        try { if (after) localStorage.setItem(POSTER_CURSOR, after); else localStorage.removeItem(POSTER_CURSOR); } catch { /* ignore */ }
        setMsg(`Posters: ${t.processed} sightings checked, ${t.updated} filled in (${t.posters} stills made, ${t.soundOnly} sound only)…`);
      } while (after);
      setMsg(`Posters done: ${t.processed} sightings checked, ${t.updated} filled in, ${t.posters} stills made, ${t.soundOnly} marked sound only${t.failed ? `, ${t.failed} could not be read` : ''}.`);
    } catch (e: any) {
      setMsg(`Stopped after ${t.processed} sightings: ${e?.message || 'the poster function is not reachable (is it deployed?)'}. Run it again to carry on from there.`);
    } finally { setBusy(''); }
  };
  return (
    <Card title="Exports and maintenance">
      <div className="flex flex-wrap gap-2">
        <Btn onClick={exportDwc} disabled={!!busy}>{busy === 'dwc' ? 'Exporting…' : 'Download the Darwin Core archive (GBIF)'}</Btn>
        <AskButton disabled={!!busy} label={busy === 'search' ? 'Adding search keys…' : 'Add search keys to older sightings'}
          question="Add search keys to every sighting that is missing them? Safe to run more than once." yes="Add search keys" onYes={backfill} />
        <AskButton disabled={!!busy} label={busy === 'posters' ? 'Giving videos posters…' : 'Give every video a poster'}
          question="Make a still, a blurred preview and a size for every older video and photo that lacks them, and mark sound-only recordings? Nothing is overwritten or deleted, and it is safe to run more than once." yes="Make posters" onYes={posters} />
      </div>
      <p className="text-xs text-stone-500 mt-2">The archive holds public sightings with a scientific name only, licensed CC BY-NC 4.0, with coordinates rounded to 0.1° and withheld for sensitive species and for explorers who didn't share the place.</p>
      {msg && <p role="status" className="text-sm text-stone-800 mt-2">{msg}</p>}
    </Card>
  );
};

const People: React.FC<{ uid: string | null; setUid: (u: string | null) => void }> = ({ uid, setUid }) => {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const search = useCallback(async (more = false) => {
    const p = new URLSearchParams({ limit: '25' });
    if (q.trim()) p.set('q', q.trim());
    if (more && next) p.set('after', next);
    try { const r = await api(`/users?${p}`); setList(l => (more ? [...l, ...r.items] : r.items)); setNext(r.next || null); } catch (e: any) { setMsg(e.message); } finally { setLoaded(true); }
  }, [q, next]);
  useEffect(() => { search(false); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (uid) { setDetail(null); api(`/users/${uid}`).then(setDetail).catch(e => setMsg(e.message)); } }, [uid]);
  const act = async (path: string, body?: any) => {
    try { await api(`/users/${uid}/${path}`, { method: 'POST', body }); setMsg('Done.'); setDetail(await api(`/users/${uid}`)); } catch (e: any) { setMsg(e.message); }
  };
  if (uid) {
    const Fact: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
      <div className={`py-1.5 border-b ${RULE} min-w-0`}><dt className="text-xs text-stone-500">{k}</dt><dd className="text-sm text-stone-900 break-words">{children}</dd></div>
    );
    return (
      <div className="space-y-4">
        <button onClick={() => setUid(null)} className="inline-flex items-center gap-1 text-sm text-stone-700 hover:text-stone-900 -ml-1 px-1 py-1"><span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_back</span>All people</button>
        {msg && <Notice>{msg}</Notice>}
        {!detail ? <Loading label="Opening their page" /> : (
          <>
            <Card title={detail.profile?.username || detail.auth?.email || uid}>
              <dl className="grid sm:grid-cols-2 gap-x-6">
                <Fact k="Account"><span className="font-mono text-xs break-all">{uid}</span></Fact>
                <Fact k="Email">{detail.auth?.email || (detail.auth?.anonymous ? 'guest' : '–')} {detail.auth?.emailVerified ? '(verified)' : ''}</Fact>
                <Fact k="Sign-in">{detail.auth?.providers?.join(', ') || 'guest'}{detail.auth?.mfa ? ' · two-step on' : ''}</Fact>
                <Fact k="Joined / last seen"><span className="tabular-nums">{detail.auth?.created} / {detail.auth?.lastSignIn}</span></Fact>
                <Fact k="Today"><span className="tabular-nums">{detail.usageToday.identify || 0} identifications · {detail.usageToday.other || 0} other AI · {Math.ceil((detail.usageToday.liveMs || 0) / 60000)} live min · {detail.usageToday.posts || 0} shared</span></Fact>
                <Fact k="Status">{detail.suspended ? <span className="text-red-700 font-medium">Suspended ({detail.suspended.reason || 'no reason given'})</span> : 'Active'}</Fact>
              </dl>
              <div className="flex gap-2 flex-wrap mt-4">
                {detail.suspended
                  ? <AskButton label="Lift the suspension" question="Lift the suspension? They can sign in again straight away." yes="Lift it" onYes={() => act('unsuspend')} />
                  : <AskButton tone="danger" label="Suspend" question="Suspend this account and sign it out everywhere?" yes="Suspend and sign out" no="Don't suspend"
                      field={{ label: 'Reason, shown in the audit log', placeholder: 'For example: repeated spam in field notes' }} onYes={reason => act('suspend', { reason })} />}
                <AskButton label="Sign out everywhere" question="Sign this account out on every device?" yes="Sign out everywhere" onYes={() => act('signout')} />
              </div>
            </Card>
            <Card title="Recent AI activity">
              {detail.aiLog.length === 0 ? <Quiet glyph="guide">No AI activity in the last 30 days.</Quiet> : (
                <ul className={`text-xs text-stone-800 divide-y ${DIVIDE}`}>{detail.aiLog.map((l: any) => <li key={l.id} className="py-1.5 flex flex-wrap gap-x-3"><span className="sm:w-40 shrink-0 tabular-nums">{when(l.at)}</span><span className="w-28">{l.task}</span><span className="tabular-nums">{l.status}</span><span className="text-amber-900">{Object.keys(l.flags || {}).filter(k => l.flags[k]).join(', ')}</span></li>)}</ul>
              )}
            </Card>
            <Card title="Recent sightings">
              {detail.posts.length === 0 ? <Quiet glyph="plate">No sightings yet.</Quiet> : (
                <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2">{detail.posts.map((p: any) => (
                  <li key={p.id} title={`${p.labels?.[0] || ''} · ${p.isPublic ? 'feed' : 'journal'} · ${p.moderation?.status || ''}`} className="relative bg-[#fbf7ef] p-1 rounded-[3px] shadow-[0_1px_2px_rgba(60,40,20,0.12)]">
                    {(p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl) ? <img src={p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl} alt="" className="aspect-square w-full object-cover bg-[#efe7d6]" /> : <div className="aspect-square bg-[#efe7d6] flex items-center justify-center text-xs text-stone-600">{p.mediaType}</div>}
                    {!p.isPublic && <span className="absolute top-1.5 left-1.5 text-[10px] bg-[#fbf7ef]/95 text-stone-700 rounded px-1">journal</span>}
                  </li>
                ))}</ul>
              )}
            </Card>
          </>
        )}
      </div>
    );
  }
  return (
    <Card title="Explorers" actions={<form onSubmit={e => { e.preventDefault(); search(false); }} className="flex gap-2 w-full sm:w-auto"><div className="relative flex-1 min-w-0"><span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-lg" aria-hidden="true">search</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Username or email" aria-label="Search people" className="w-full sm:w-64 bg-white border border-stone-300 rounded-full pl-9 pr-3 py-2 text-sm" /></div><Btn type="submit">Search</Btn></form>}>
      {msg && <Notice tone="warn">{msg}</Notice>}
      {!loaded ? <Loading label="Looking through the register" /> : list.length === 0 ? <Quiet glyph="binoculars">No explorers match that.</Quiet> : (
        <ul className={`divide-y ${DIVIDE}`}>{list.map(u => (
          <li key={u.id}><button onClick={() => setUid(u.id)} className="w-full text-left py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 hover:bg-[#f6f0e3] px-2 rounded min-w-0">
            <span className="font-medium text-sm text-stone-900 truncate max-w-full">{u.username || u.email || u.id}</span>
            <span className="text-xs text-stone-500 tabular-nums flex items-center">{u.stats ? `${u.stats.observations || 0} sightings` : ''} {u.joinedAt ? `· joined ${new Date(u.joinedAt).toLocaleDateString()}` : ''}<span className="material-symbols-outlined text-base text-stone-400" aria-hidden="true">chevron_right</span></span>
          </button></li>
        ))}</ul>
      )}
      {next && !q && <Btn className="mt-3" onClick={() => search(true)}>Load more</Btn>}
    </Card>
  );
};

const Letters: React.FC = () => {
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState<{ cid: string; msgs: any[] } | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/letters/reported').then(r => setItems(r.items)).catch(e => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600 max-w-3xl">Letters are private. A conversation can be read here only after one of its participants reports it, and each reading is recorded in the audit log.</p>
      {msg && <Notice tone="warn">{msg}</Notice>}
      <Card title="Reported conversations">
        {!items ? <Loading label="Gathering reports" /> : items.length === 0 ? <Quiet glyph="letter">No open reports. Letters are left sealed.</Quiet> : (
          <ul className={`divide-y ${DIVIDE}`}>{items.map(r => (
            <li key={r.id} className="py-2.5 flex flex-wrap gap-2 items-center justify-between text-sm text-stone-800">
              <span className="min-w-0 break-words"><span className="tabular-nums text-stone-500">{when(r.createdAt)}</span> · {r.reason}{r.details ? ` · ${r.details}` : ''}</span>
              <span className="flex gap-2">
                <Btn onClick={async () => { try { const m = await api(`/letters/${r.cid}`); setOpen({ cid: r.cid, msgs: m.items }); } catch (e: any) { setMsg(e.message); } }}>Read it</Btn>
                <Btn onClick={async () => { await api(`/letters/${r.cid}/close`, { method: 'POST' }); setOpen(null); load(); }}>Close the report</Btn>
              </span>
            </li>
          ))}</ul>
        )}
      </Card>
      {open && (
        <Card title="The conversation" actions={<button onClick={() => setOpen(null)} aria-label="Close the conversation" className="w-9 h-9 rounded-full hover:bg-[#f1e9d9] flex items-center justify-center text-stone-600"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>}>
          <ul className="space-y-3 text-sm">{open.msgs.map(m => <li key={m.id} className="border-l-2 border-[#d8ccb6] pl-3"><span className="font-mono text-xs text-stone-500">{String(m.senderId).slice(0, 8)} · <span className="tabular-nums">{when(m.createdAt)}</span></span><p className="text-stone-900 break-words">{m.text}</p></li>)}</ul>
        </Card>
      )}
    </div>
  );
};

const COLLECTIONS = ['users', 'ecosystem_feed', 'feed_thumbnails', 'ai_log', 'ai_usage', 'usage_global', 'ai_results', 'ai_feedback', 'review_queue', 'letter_reports', 'suspended', 'admin_audit', 'app_config', 'config', 'live_leases', 'themes', 'daily_themes', 'media_variants', 'naturalist_profiles'];

const DataExplorer: React.FC = () => {
  const [col, setCol] = useState('ecosystem_feed');
  const [where, setWhere] = useState('');
  const [equals, setEquals] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [migrating, setMigrating] = useState('');
  const load = async (more = false) => {
    const p = new URLSearchParams({ limit: '50' });
    if (where.trim()) { p.set('where', where.trim()); p.set('equals', equals); }
    if (more && next) p.set('after', next);
    try { setMsg(''); const r = await api(`/explore/${col}?${p}`); setItems(i => (more ? [...i, ...r.items] : r.items)); setNext(r.next); } catch (e: any) { setMsg(e.message); }
  };
  useEffect(() => { setItems([]); setSel(null); load(false); /* eslint-disable-next-line */ }, [col]);
  const columns = useMemo(() => {
    const counts = new Map<string, number>();
    items.slice(0, 50).forEach(it => Object.keys(it).forEach(k => counts.set(k, (counts.get(k) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter(k => k !== 'id').slice(0, 6);
  }, [items]);
  const download = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${col}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const cell = (v: any) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));
  return (
    <div className="space-y-4">
      <Card title="Look through the records">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 items-end">
          <label className="col-span-2 text-sm text-stone-700">Collection<select value={col} onChange={e => setCol(e.target.value)} className={`${INPUT} sm:w-56 font-mono`}>{COLLECTIONS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="text-sm text-stone-700">Field<input value={where} onChange={e => setWhere(e.target.value)} placeholder="e.g. userId" className={`${INPUT} font-mono`} /></label>
          <label className="text-sm text-stone-700">Equals<input value={equals} onChange={e => setEquals(e.target.value)} className={INPUT} /></label>
          <Btn tone="primary" onClick={() => load(false)}>Look</Btn>
          <Btn onClick={download} disabled={!items.length}>Download JSON</Btn>
        </div>
        <p className="text-xs text-stone-500 mt-2">Read only. Letters are not listed here.</p>
      </Card>
      {msg && <Notice tone="warn">{msg}</Notice>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={<span className="tabular-nums">{items.length} documents</span>}>
          {items.length === 0 ? <Quiet glyph="notebook">No documents to show.</Quiet> : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="w-full text-xs text-stone-800">
                <thead><tr className="text-left"><th className={TH}>id</th>{columns.map(c => <th key={c} className={TH}>{c}</th>)}</tr></thead>
                <tbody>{items.map(it => (
                  <tr key={it.id} onClick={() => setSel(it)} className={`border-t ${RULE} cursor-pointer hover:bg-[#f6f0e3] ${sel?.id === it.id ? 'bg-[#efe5d1]' : ''}`}>
                    <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{it.id.slice(0, 12)}</td>{columns.map(c => <td key={c} className="pr-3 whitespace-nowrap">{cell(it[c])}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {next && <Btn className="mt-3" onClick={() => load(true)}>Load more</Btn>}
        </Card>
        <Card title={sel ? <span className="font-mono text-base break-all">{sel.id}</span> : 'Pick a document'}>{sel ? <Json value={sel} /> : <p className="text-sm text-stone-600">Its full contents appear here.</p>}</Card>
      </div>
      <Card title="One-off tools">
        <p className="text-sm text-stone-600 mb-2">Move precise locations from older public sightings into each explorer's private records.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Btn onClick={async () => { try { const c = await FirebaseService.migratePublicLocationsToPrivate((d, t) => setMigrating(`${d}/${t}`)); setMigrating(`Done: ${c} sightings secured.`); } catch (e: any) { setMigrating(e.message); } }}>Run the privacy migration</Btn>
          {migrating && <span role="status" className="text-sm text-stone-800 tabular-nums">{migrating}</span>}
        </div>
      </Card>
    </div>
  );
};

const Security: React.FC = () => {
  const [sec, setSec] = useState<any>(null);
  const [auditRows, setAudit] = useState<any[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [prefix, setPrefix] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api('/security'), api('/audit')]);
      setSec(s); setAudit(a.items); setBefore(a.before);
    } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const block = async (unblock = false, p = prefix) => {
    try { await api(`/networks/${unblock ? 'unblock' : 'block'}`, { method: 'POST', body: { prefix: p } }); setPrefix(''); load(); } catch (e: any) { setMsg(e.message); }
  };
  const mfa = async () => {
    if (!sec) return;
    try { await api('/settings', { method: 'PUT', body: { requireAdminMfa: !sec.requireAdminMfa } }); load(); } catch (e: any) { setMsg(e.message); }
  };
  if (!sec) return msg ? <Notice tone="warn" alert>{msg}</Notice> : <Loading label="Checking the locks" />;
  const extra = sec.adminHolders.length !== 1;
  const Line: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
    <li className={`py-2 border-b ${RULE} grid sm:grid-cols-[16rem_1fr] gap-x-4 gap-y-0.5`}><span className="text-stone-500">{k}</span><span className="text-stone-900 break-words">{children}</span></li>
  );
  return (
    <div className="space-y-4">
      {msg && <Notice>{msg}</Notice>}
      <Card title="Who is admin">
        {extra && <div className="mb-3"><Notice tone="warn" alert>{sec.adminHolders.length} accounts hold the admin claim. Run scripts/set-admin.mjs to leave exactly one.</Notice></div>}
        <ul className="text-sm space-y-1.5 text-stone-800">{sec.adminHolders.map((h: any) => <li key={h.uid} className="break-words"><span className="font-medium text-stone-900">{h.email}</span> <span className="font-mono text-xs text-stone-500 break-all">{h.uid}</span> · two-step {h.mfa ? 'on' : <span className="text-amber-800">off</span>} · last sign-in <span className="tabular-nums">{h.lastSignIn}</span></li>)}</ul>
        <p className="text-xs text-stone-500 mt-2">The server also requires the account named in ADMIN_UIDS ({sec.namedAdmin.uids ? sec.namedAdmin.uids.join(', ') : `email ${sec.namedAdmin.email}; set ADMIN_UIDS to pin it`}), a verified email, a sign-in within {sec.sessionHours} hours, and a token that hasn't been revoked.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-stone-800">Two-step sign-in for this console: <b className="font-medium">{sec.requireAdminMfa ? 'required' : 'not required'}</b></span>
          <AskButton label={sec.requireAdminMfa ? 'Stop requiring it' : 'Require two-step sign-in'}
            question={sec.requireAdminMfa ? 'Stop requiring two-step sign-in for the admin console?' : 'Require two-step sign-in for the admin console? Make sure your account has it set up first, or you will be locked out until it is.'}
            yes={sec.requireAdminMfa ? 'Stop requiring it' : 'Require it'} onYes={mfa} />
        </div>
      </Card>
      <Card title="Blocked networks">
        <form onSubmit={e => { e.preventDefault(); if (prefix.trim()) block(false); }} className="flex gap-2 mb-3"><input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="IP address or prefix, e.g. 203.0.113." aria-label="Network to block" className={`${INPUT} mt-0 font-mono flex-1 min-w-0`} /><Btn type="submit" tone="danger">Block</Btn></form>
        {sec.blockedNetworks.length === 0 ? <p className="text-sm font-display italic text-stone-500">No networks blocked.</p> : <ul className={`text-sm divide-y ${DIVIDE}`}>{sec.blockedNetworks.map((p: string) => <li key={p} className="flex justify-between items-center py-1.5"><span className="font-mono text-stone-900">{p}</span><button onClick={() => block(true, p)} className={`${linkCls} text-sm`}>Unblock</button></li>)}</ul>}
      </Card>
      <Card title="Server">
        <ul className="text-sm">
          <Line k="Database from the server">{sec.store.ok ? 'Reachable' : <b className="text-amber-800 font-medium">Not reachable ({sec.store.error})</b>}</Line>
          <Line k="Separate service account">{sec.env.serviceAccount ? 'Yes' : 'No (uses the runtime account)'}</Line>
          <Line k="Allowances when the database is down">{sec.env.quotaFailOpen ? <b className="text-amber-800 font-medium">Allowed (development setting, turn it off)</b> : 'Refused (safe)'}</Line>
          <Line k="App Check">{sec.runtime?.appCheck ? <span className="tabular-nums">{sec.runtime.appCheck.mode} (since restart: {sec.runtime.appCheck.ok} verified, {sec.runtime.appCheck.missing} without a token, {sec.runtime.appCheck.invalid} invalid)</span> : sec.env.appCheck}</Line>
          {sec.runtime?.leases && <Line k="Live sessions counted across servers">{sec.runtime.leases.shared ? 'Yes' : <b className="text-amber-800 font-medium">No, this server counts on its own{sec.runtime.leases.lastError ? ` (${sec.runtime.leases.lastError})` : ''}</b>}</Line>}
          {sec.runtime && <Line k="Live connection">{sec.runtime.liveDirect ? 'Direct to Gemini with one-use tokens' : 'Through this server'}</Line>}
          {sec.runtime && <Line k="When the image check is down">{sec.runtime.moderationFailOpen ? 'Publish and queue for a look' : 'Hold for review'}</Line>}
        </ul>
      </Card>
      <Card title="Audit log of every admin action">
        {auditRows.length === 0 ? <Quiet glyph="seal">No admin actions recorded yet.</Quiet> : (
          <ul className={`text-xs divide-y ${DIVIDE}`}>{auditRows.map(a => <li key={a.id} className="py-2 flex flex-wrap gap-x-3 gap-y-0.5"><span className="sm:w-40 shrink-0 tabular-nums text-stone-600">{when(a.at)}</span><span className="font-semibold text-stone-900">{a.action}</span><span className="text-stone-600 break-all basis-full sm:basis-auto sm:flex-1 font-mono text-[11px]">{JSON.stringify(a.details)}</span><span className="text-stone-400 font-mono">{a.ip}</span></li>)}</ul>
        )}
        {before && <Btn className="mt-3" onClick={async () => { const r = await api(`/audit?before=${before}`); setAudit(x => [...x, ...r.items]); setBefore(r.before); }}>Load older entries</Btn>}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------- shell

const AdminConsole: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [state, setState] = useState<'checking' | 'ok' | 'denied' | 'reauth' | 'mfa'>('checking');
  const [section, setSection] = useState<Section>('overview');
  const [uid, setUid] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [why, setWhy] = useState('');

  useEffect(() => {
    api('/me').then(m => { setMe(m); setState('ok'); }).catch((e: ApiError) => {
      // Say what went wrong (not signed in, server can't check, refused) instead of one catch-all line
      setWhy(e.status === 403 ? '' : `${e.message}${e.status ? ` (${e.status})` : ''}`);
      setState(e.code === 'reauth' ? 'reauth' : e.code === 'mfa' ? 'mfa' : 'denied');
    });
  }, []);
  const openUser = (u: string) => { setUid(u); setSection('people'); };
  const pick = (s: Section) => { setSection(s); if (s !== 'people') setUid(null); };

  if (state !== 'ok') {
    const [title, body] = state === 'checking' ? ['', '']
      : state === 'reauth' ? ['Sign in again, please', 'For safety, sign out and sign in again to open the admin console.']
      : state === 'mfa' ? ['Two-step sign-in needed', 'The admin console needs two-step sign-in on this account.']
      : why ? ["We couldn't check your access", why]
      : ["The curator's office", 'This area is for the NatureGram admin.'];
    return (
      <div className="flex-1 min-h-0 h-full overflow-y-auto bg-[#f6f1e6] flex items-center justify-center p-6">
        {state === 'checking' ? <PressingLoader label="Checking access…" /> : (
          <div className="w-full max-w-sm rounded-[3px] p-2.5 bg-[#fbf7ef] shadow-[0_1px_2px_rgba(60,40,20,0.12),0_10px_30px_-12px_rgba(60,40,20,0.3)]">
            <div className="rounded-[2px] border border-[#d8ccb6] outline outline-1 outline-offset-[3px] outline-[#e8dfcd] px-6 py-8 text-center flex flex-col items-center">
              <Glyph name="seal" size={44} strokeWidth={1.2} className="text-[#a8957a]" />
              <h1 className="mt-3 font-display text-2xl text-stone-900">{title}</h1>
              <p role={state === 'denied' && why ? 'alert' : undefined} className="mt-2 text-sm text-stone-700 break-words">{body}</p>
              <Btn className="mt-6" onClick={onBack}><span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_back</span>Back to the app</Btn>
            </div>
          </div>
        )}
      </div>
    );
  }

  const current = SECTIONS.find(s => s.id === section)!;
  return (
    <div className="flex-1 min-h-0 h-full overflow-y-auto bg-[#f6f1e6] text-stone-900">
      <header className="sticky top-0 z-20 bg-[#fbf7ef]/95 backdrop-blur border-b border-[#e3d8c4] safe-pt">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={onBack} aria-label="Back to the app" className="w-10 h-10 -ml-2 rounded-full hover:bg-[#f1e9d9] flex items-center justify-center text-stone-700"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
          <div className="min-w-0">
            <h1 className="font-display text-lg leading-tight text-stone-900">Curator's office</h1>
            <p className="text-[11px] text-stone-500 leading-tight">NatureGram admin</p>
          </div>
          <span className="ml-auto text-xs text-stone-500 truncate max-w-[40%]">{me?.email}</span>
        </div>
        <nav aria-label="Admin sections" className="lg:hidden flex gap-1.5 overflow-x-auto no-scrollbar px-4 pb-2.5">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={e => { pick(s.id); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }} aria-current={section === s.id ? 'page' : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-sm border transition-colors ${section === s.id ? 'bg-stone-900 border-stone-900 text-[#fbf7ef]' : 'bg-white/60 border-[#e3d8c4] text-stone-700'}`}>
              <Glyph name={s.glyph} size={16} />{s.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="max-w-7xl mx-auto lg:grid lg:grid-cols-[14rem_1fr] lg:gap-8 px-4">
        <nav aria-label="Admin sections" className="hidden lg:block">
          <ul className="sticky top-20 py-6 space-y-0.5">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <button onClick={() => pick(s.id)} aria-current={section === s.id ? 'page' : undefined}
                  className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors border-l-2 ${section === s.id ? 'bg-[#efe5d1] border-theme-accent text-stone-900 font-medium' : 'border-transparent text-stone-600 hover:bg-[#f1e9d9] hover:text-stone-900'}`}>
                  <Glyph name={s.glyph} size={18} className={section === s.id ? 'text-theme-accent' : 'text-stone-500'} />{s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 py-5 lg:py-6 pb-16">
          <div className="flex items-start gap-3 mb-5">
            <span className="mt-0.5 w-10 h-10 shrink-0 rounded-full bg-[#fbf7ef] border border-[#e3d8c4] flex items-center justify-center text-theme-accent"><Glyph name={current.glyph} size={22} /></span>
            <div className="min-w-0">
              <h2 className="font-display text-2xl leading-tight text-stone-900">{current.label}</h2>
              <p className="text-sm text-stone-600 mt-0.5">{current.blurb}</p>
            </div>
          </div>
          {section === 'overview' && <Overview go={pick} />}
          {section === 'controls' && <Controls />}
          {section === 'ai' && <AiGovernance />}
          {section === 'monitor' && <Monitor openUser={openUser} />}
          {section === 'review' && <Review openUser={openUser} />}
          {section === 'people' && <People uid={uid} setUid={setUid} />}
          {section === 'letters' && <Letters />}
          {section === 'experiments' && <Experiments />}
          {section === 'branding' && <Branding />}
          {section === 'data' && <div className="space-y-4"><DataTools /><DataExplorer /></div>}
          {section === 'security' && <Security />}
        </main>
      </div>
    </div>
  );
};

export default AdminConsole;
