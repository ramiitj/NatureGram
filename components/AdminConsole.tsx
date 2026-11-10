import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebaseConfig';
import { apiUrl } from '../services/apiOrigin';
import { FirebaseService } from '../services/firebaseService';
import AiQualityPanel from './AiQualityPanel';

/**
 * NatureGram admin console. Every read and change goes through the server's admin API,
 * which checks that the caller is the named admin, validates the change, keeps the previous
 * version and writes the audit log. Nothing here talks to the database directly.
 */

type Section = 'overview' | 'controls' | 'ai' | 'monitor' | 'review' | 'people' | 'letters' | 'experiments' | 'data' | 'security';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'monitoring' },
  { id: 'controls', label: 'Allowances & switches', icon: 'tune' },
  { id: 'ai', label: 'AI governance', icon: 'psychology' },
  { id: 'monitor', label: 'AI monitor', icon: 'query_stats' },
  { id: 'review', label: 'Review', icon: 'fact_check' },
  { id: 'people', label: 'People', icon: 'group' },
  { id: 'letters', label: 'Reported letters', icon: 'mail' },
  { id: 'experiments', label: 'Experiments', icon: 'science' },
  { id: 'data', label: 'Data explorer', icon: 'database' },
  { id: 'security', label: 'Audit & security', icon: 'shield_lock' },
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

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : '–');
const n = (v: any) => (typeof v === 'number' ? v.toLocaleString() : '–');
const Card: React.FC<{ title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }> = ({ title, children, className = '', actions }) => (
  <section className={`bg-white border border-stone-200 rounded-2xl p-5 ${className}`}>
    {(title || actions) && <div className="flex items-center justify-between gap-3 mb-3">{title && <h3 className="font-bold text-stone-900">{title}</h3>}{actions}</div>}
    {children}
  </section>
);
const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'warn' | 'ok' }> = ({ label, value, tone }) => (
  <div className={`rounded-2xl border p-4 ${tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}>
    <p className="text-xs font-semibold text-stone-500">{label}</p>
    <p className="text-2xl font-bold text-stone-900 mt-1 tabular-nums">{value}</p>
  </div>
);
const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'danger' | 'plain' }> = ({ tone = 'plain', className = '', ...p }) => (
  <button {...p} className={`px-3.5 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 ${tone === 'primary' ? 'bg-stone-900 text-white' : tone === 'danger' ? 'bg-red-700 text-white' : 'border border-stone-300 text-stone-800 hover:bg-stone-50'} ${className}`} />
);
const Json: React.FC<{ value: any }> = ({ value }) => (
  <pre className="text-xs bg-stone-50 border border-stone-200 rounded-xl p-3 overflow-auto max-h-96 whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
);
const Bars: React.FC<{ values: number[]; label: string }> = ({ values, label }) => {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={label} className="flex items-end gap-[3px] h-24">
      {values.map((v, i) => <div key={i} title={`${v}`} className="flex-1 bg-emerald-700/80 rounded-t" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />)}
    </div>
  );
};

// ---------------------------------------------------------------------------- sections

const Overview: React.FC<{ go: (s: Section) => void }> = ({ go }) => {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api('/overview').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  if (err) return <p className="text-red-700">{err}</p>;
  if (!d) return <p className="text-stone-600">Loading…</p>;
  const pctCeiling = d.ceiling ? Math.round((d.tokensToday / d.ceiling) * 100) : 0;
  return (
    <div className="space-y-5">
      {!d.store.ok && <p role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-900">The server can't reach the database ({d.store.error}). Allowances fail closed, so AI features are refusing requests until this is fixed.</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="AI calls, last 24 h" value={n(d.last24h.calls)} />
        <Stat label="Errors, last 24 h" value={n(d.last24h.errors)} tone={d.last24h.errors > d.last24h.calls * 0.05 ? 'warn' : undefined} />
        <Stat label="Explorers using AI, 24 h" value={n(d.last24h.activeExplorers)} />
        <Stat label="Sightings shared today" value={n(d.postsToday)} />
        <Stat label="Tokens today" value={`${n(d.tokensToday)}${d.ceiling ? ` (${pctCeiling}% of ceiling)` : ''}`} tone={pctCeiling > 80 ? 'warn' : undefined} />
        <Stat label="Waiting for review" value={<button onClick={() => go('review')} className="underline">{d.queues.review}</button>} tone={d.queues.review ? 'warn' : undefined} />
        <Stat label="Reported sightings" value={<button onClick={() => go('review')} className="underline">{d.queues.reported}</button>} tone={d.queues.reported ? 'warn' : undefined} />
        <Stat label="Reported letters" value={<button onClick={() => go('letters')} className="underline">{d.queues.letters}</button>} tone={d.queues.letters ? 'warn' : undefined} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="AI calls per hour (last 24 h)"><Bars values={d.last24h.hourly} label="AI calls per hour over the last day" /></Card>
        <Card title="By task and by flag">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <ul>{Object.entries(d.last24h.byTask).map(([k, v]) => <li key={k} className="flex justify-between border-b border-stone-100 py-1"><span>{k}</span><span className="tabular-nums">{String(v)}</span></li>)}</ul>
            <ul>{Object.keys(d.last24h.flagged).length === 0 ? <li className="text-stone-500">No flags</li> : Object.entries(d.last24h.flagged).map(([k, v]) => <li key={k} className="flex justify-between border-b border-stone-100 py-1"><span>{k}</span><span className="tabular-nums">{String(v)}</span></li>)}</ul>
          </div>
        </Card>
      </div>
      <Card title="Current state">
        <div className="flex flex-wrap gap-2 text-sm">
          {['aiEnabled', 'liveEnabled', 'uploadsEnabled', 'guestsEnabled', 'lettersEnabled', 'signupsEnabled'].map(k => (
            <span key={k} className={`px-2.5 py-1 rounded-full ${d.flags[k] ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>{k.replace('Enabled', '')}: {d.flags[k] ? 'on' : 'off'}</span>
          ))}
          <span className="px-2.5 py-1 rounded-full bg-stone-100">Daily: {d.flags.allowances.postsPerDay} posts · {d.flags.allowances.liveMinutesPerDay} live min · {d.flags.allowances.identificationsPerDay} identifications</span>
          <span className="px-2.5 py-1 rounded-full bg-stone-100">Policy v{d.policy}</span>
        </div>
      </Card>
    </div>
  );
};

const Controls: React.FC = () => {
  const [flags, setFlags] = useState<any>(null);
  const [caps, setCaps] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const [f, s] = await Promise.all([api('/flags'), api('/settings')]);
    setFlags(f); setCaps(s.settings.caps);
  }, []);
  useEffect(() => { load().catch(e => setMsg(e.message)); }, [load]);
  if (!flags || !caps) return <p className="text-stone-600">{msg || 'Loading…'}</p>;

  const toggle = async (k: string) => {
    if (!confirm(`Turn ${k.replace('Enabled', '')} ${flags[k] ? 'off' : 'on'} for everyone?`)) return;
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
  const SW: [string, string][] = [
    ['aiEnabled', 'All AI features'], ['liveEnabled', 'Live guide'], ['uploadsEnabled', 'Sharing new sightings'],
    ['guestsEnabled', 'Guests using AI'], ['lettersEnabled', 'Letters'], ['signupsEnabled', 'New accounts'],
  ];
  const CAPS: Record<string, string> = {
    otherAiCallsPerDay: 'Other AI calls per account per day (descriptions, curation, summaries)', maxOutputTokens: 'Longest AI answer (tokens)',
    thinkingBudget: 'Thinking budget per answer (tokens)', dailyTokenCeiling: 'Daily token ceiling for everyone (0 = none)',
    liveSessionsPerNetworkPerHour: 'Live sessions per network per hour', liveConcurrentPerNetwork: 'Live sessions open at once per network',
  };
  return (
    <div className="space-y-4">
      {msg && <p role="status" className="text-sm rounded-xl bg-stone-100 p-3">{msg}</p>}
      <Card title="Daily allowance (every account, no exceptions)">
        <form onSubmit={saveAllowances} className="grid sm:grid-cols-3 gap-3 items-end">
          <label className="text-sm">Sightings shared per day<input name="posts" type="number" min={0} max={100} defaultValue={flags.allowances.postsPerDay} className="mt-1 w-full border border-stone-300 rounded-xl px-3 py-2" /></label>
          <label className="text-sm">Live guide minutes per day<input name="live" type="number" min={0} max={240} defaultValue={flags.allowances.liveMinutesPerDay} className="mt-1 w-full border border-stone-300 rounded-xl px-3 py-2" /></label>
          <label className="text-sm">AI identifications per day<input name="ids" type="number" min={0} max={500} defaultValue={flags.allowances.identificationsPerDay} className="mt-1 w-full border border-stone-300 rounded-xl px-3 py-2" /></label>
          <Btn tone="primary" type="submit" className="sm:col-span-3 justify-self-start">Save allowances</Btn>
        </form>
        <p className="text-xs text-stone-500 mt-3">Counted on the server per account per day (UTC). An identification is one photo, sound or clip the guide names.</p>
      </Card>
      <Card title="Switches">
        <ul className="divide-y divide-stone-100">
          {SW.map(([k, label]) => (
            <li key={k} className="flex items-center justify-between py-2.5">
              <span className="text-sm">{label}</span>
              <button role="switch" aria-checked={!!flags[k]} onClick={() => toggle(k)} className={`w-12 h-7 rounded-full relative transition-colors ${flags[k] ? 'bg-emerald-700' : 'bg-stone-300'}`}>
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${flags[k] ? 'left-6' : 'left-1'}`} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Limits and spending">
        <form onSubmit={saveCaps} className="grid sm:grid-cols-2 gap-3">
          {Object.keys(CAPS).map(k => (
            <label key={k} className="text-sm">{CAPS[k]}<input name={k} type="number" defaultValue={caps[k]} className="mt-1 w-full border border-stone-300 rounded-xl px-3 py-2" /></label>
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
  const load = useCallback(() => api('/settings').then(setData).catch(e => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data) setDraft(tab === 'policy' ? data.settings.policy : data.settings.prompts[which] || ''); }, [data, which, tab]);
  useEffect(() => { if (tab === 'history') api('/history/settings').then(r => setHistory(r.items)).catch(e => setMsg(e.message)); }, [tab]);
  if (!data) return <p className="text-stone-600">{msg || 'Loading…'}</p>;
  const s = data.settings;

  const save = async (patch: any, what: string) => {
    if (!confirm(`Save the ${what}? It applies to every AI call within 30 seconds.`)) return;
    try { await api('/settings', { method: 'PUT', body: patch }); await load(); setMsg(`${what} saved. The previous version is in History.`); } catch (e: any) { setMsg(e.message); }
  };
  const rollback = async (id: string) => {
    if (!confirm('Restore the settings as they were before this change?')) return;
    try { await api(`/history/settings/${id}/rollback`, { method: 'POST' }); await load(); setMsg('Restored.'); setTab('prompts'); } catch (e: any) { setMsg(e.message); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">These control how the AI behaves for every explorer. The app cannot change them: the server applies them to each call, adds the platform policy after the prompt, and passes anything explorers write as information, never as instructions.</p>
      <div className="flex gap-2 flex-wrap">
        {(['prompts', 'policy', 'models', 'guidance', 'history'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${tab === t ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {msg && <p role="status" className="text-sm rounded-xl bg-stone-100 p-3">{msg}</p>}
      {tab === 'prompts' && (
        <Card>
          <div className="flex gap-2 flex-wrap mb-3">
            {Object.keys(s.prompts).map(k => <button key={k} onClick={() => setWhich(k)} className={`px-3 py-1.5 rounded-xl text-sm ${which === k ? 'bg-emerald-800 text-white' : 'border border-stone-300'}`}>{PROMPT_LABELS[k] || k}</button>)}
          </div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={18} aria-label={`${PROMPT_LABELS[which]} prompt`} className="w-full font-mono text-xs bg-stone-50 border border-stone-200 rounded-xl p-3" />
          <div className="flex gap-2 mt-3 flex-wrap">
            <Btn tone="primary" onClick={() => save({ prompts: { [which]: draft } }, `${PROMPT_LABELS[which]} prompt`)} disabled={draft === s.prompts[which]}>Save prompt</Btn>
            <Btn onClick={() => setDraft(data.defaults.prompts[which])}>Load the original</Btn>
            <span className="text-xs text-stone-500 self-center">{draft.length.toLocaleString()} characters</span>
          </div>
        </Card>
      )}
      {tab === 'policy' && (
        <Card title="Platform policy (added after every prompt; it overrides them)">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={16} aria-label="Platform policy" className="w-full font-mono text-xs bg-stone-50 border border-stone-200 rounded-xl p-3" />
          <div className="flex gap-2 mt-3">
            <Btn tone="primary" onClick={() => save({ policy: draft }, 'platform policy')} disabled={draft === s.policy}>Save policy</Btn>
            <Btn onClick={() => setDraft(data.defaults.policy)}>Load the original</Btn>
          </div>
        </Card>
      )}
      {tab === 'models' && (
        <Card title="Models">
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const models: any = {}; Object.keys(s.models).forEach(k => { models[k] = String(f.get(k)).trim(); }); save({ models }, 'models'); }} className="grid sm:grid-cols-2 gap-3">
            {Object.keys(s.models).map(k => <label key={k} className="text-sm">{PROMPT_LABELS[k] || k}<input name={k} defaultValue={s.models[k]} className="mt-1 w-full border border-stone-300 rounded-xl px-3 py-2 font-mono text-xs" /></label>)}
            <Btn tone="primary" type="submit" className="justify-self-start">Save models</Btn>
          </form>
          <p className="text-xs text-stone-500 mt-3">Only Gemini model names are accepted. The live guide needs a native-audio model (models/…).</p>
        </Card>
      )}
      {tab === 'guidance' && (
        <Card title="What explorers see when a capture is held back">
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const guidance: any = {}; Object.keys(s.guidance).forEach(k => { guidance[k] = String(f.get(k)); }); save({ guidance }, 'messages'); }} className="space-y-3">
            {Object.keys(s.guidance).map(k => <label key={k} className="block text-sm">{GUIDANCE_LABELS[k] || k}<textarea name={k} defaultValue={s.guidance[k]} rows={2} maxLength={400} className="mt-1 w-full border border-stone-300 rounded-xl px-3 py-2" /></label>)}
            <Btn tone="primary" type="submit">Save messages</Btn>
          </form>
        </Card>
      )}
      {tab === 'history' && (
        <Card title="Changes (newest first)">
          {!history ? <p className="text-stone-600">Loading…</p> : history.length === 0 ? <p className="text-stone-600">No changes yet.</p> : (
            <ul className="divide-y divide-stone-100">
              {history.map(h => (
                <li key={h.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                  <div className="text-sm"><span className="font-semibold">{when(h.at)}</span> · {h.email || h.by} · changed {Object.keys(h.patch || {}).join(', ')}</div>
                  <Btn onClick={() => rollback(h.id)}>Restore what it replaced</Btn>
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
    try { const r = await api(`/ai-log?${q}`); setRows(p => (more ? [...p, ...r.items] : r.items)); setBefore(r.before); } catch (e: any) { setMsg(e.message); }
  }, [task, flagged, before]);
  useEffect(() => { if (view === 'log') load(false); /* eslint-disable-next-line */ }, [task, flagged, view]);
  useEffect(() => { if (view === 'usage') api('/usage').then(setUsage).catch(e => setMsg(e.message)); }, [view]);
  const loadQuality = useCallback(() => api('/ai-quality?limit=1000').then(r => r.items), []);
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {(['log', 'usage', 'quality'] as const).map(v => <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${view === v ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}>{v === 'log' ? 'Every AI call' : v === 'usage' ? "Today's usage by explorer" : 'Identification quality'}</button>)}
      </div>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
      {view === 'log' && (
        <Card actions={<div className="flex gap-2 items-center text-sm">
          <select value={task} onChange={e => setTask(e.target.value)} className="border border-stone-300 rounded-lg px-2 py-1"><option value="">All tasks</option>{['ng-identify', 'ng-describe', 'ng-curate', 'ng-synthesize', 'live', 'moderate', 'blocked'].map(t => <option key={t}>{t}</option>)}</select>
          <label className="flex items-center gap-1"><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} />Only unusual</label>
          <Btn onClick={() => load(false)}>Refresh</Btn>
        </div>}>
          <p className="text-xs text-stone-500 mb-2">One line per call: who, what, how big, how long, and anything unusual. Content is never stored. Kept 30 days.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-stone-500"><th className="py-1 pr-2">When</th><th className="pr-2">Explorer</th><th className="pr-2">Task</th><th className="pr-2">Status</th><th className="pr-2">ms</th><th className="pr-2">Tokens</th><th className="pr-2">Ended</th><th>Flags</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const odd = r.status >= 400 || r.blockReason || (r.finishReason && r.finishReason !== 'STOP') || Object.values(r.flags || {}).some(Boolean);
                  return (
                    <tr key={r.id} className={`border-t border-stone-100 ${odd ? 'bg-amber-50' : ''}`}>
                      <td className="py-1 pr-2 whitespace-nowrap">{when(r.at)}</td>
                      <td className="pr-2"><button onClick={() => openUser(r.uid)} className="underline font-mono">{String(r.uid || '').slice(0, 8)}</button>{r.anon ? ' (guest)' : ''}</td>
                      <td className="pr-2">{r.task}</td><td className="pr-2">{r.status}</td><td className="pr-2 tabular-nums">{r.ms ?? ''}</td>
                      <td className="pr-2 tabular-nums">{r.totalTokens ?? ''}</td><td className="pr-2">{r.blockReason || r.finishReason || ''}</td>
                      <td>{Object.entries(r.flags || {}).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k}: ${v}`)).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {before && <Btn className="mt-3" onClick={() => load(true)}>Load older</Btn>}
        </Card>
      )}
      {view === 'usage' && (
        <Card title={usage ? `${usage.explorers} explorers used something today (${usage.day})` : 'Loading…'}>
          {usage && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th className="py-1">Explorer</th><th>Identifications</th><th>Other AI</th><th>Live min</th><th>Shared</th></tr></thead>
              <tbody>{usage.items.map((u: any) => (
                <tr key={u.id} className="border-t border-stone-100"><td className="py-1"><button onClick={() => openUser(u.uid)} className="underline font-mono text-xs">{String(u.uid).slice(0, 10)}</button></td><td>{u.identify || 0}</td><td>{u.other || 0}</td><td>{Math.ceil((u.liveMs || 0) / 60000)}</td><td>{u.posts || 0}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
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
  const decide = async (id: string, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? prompt('A short note for the explorer (optional):') ?? '' : '';
    try { await api(`/review/${id}`, { method: 'POST', body: { action, note } }); setMsg(action === 'approve' ? 'Approved.' : 'Kept in their journal.'); load(); } catch (e: any) { setMsg(e.message); }
  };
  const act = async (id: string, action: string) => {
    if (action === 'delete' && !confirm('Delete this sighting permanently?')) return;
    try { await api(`/posts/${id}`, { method: 'POST', body: { action } }); load(); } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="space-y-4">
      {msg && <p role="status" className="text-sm rounded-xl bg-stone-100 p-3">{msg}</p>}
      <Card title="Moderation queue" actions={<Btn onClick={load}>Refresh</Btn>}>
        {!queue ? <p className="text-stone-600">Loading…</p> : queue.length === 0 ? <p className="text-stone-600">Nothing waiting.</p> : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {queue.map(q => (
              <li key={q.id} className="border border-stone-200 rounded-xl overflow-hidden">
                {q.thumb && <img src={q.thumb} alt="" className="w-full aspect-square object-cover bg-stone-100" />}
                <div className="p-3 space-y-2 text-sm">
                  <p className="font-semibold">{KIND_LABEL[q.kind || 'privacy'] || 'Review'}</p>
                  <p><span className="font-semibold">Why:</span> {(q.reasons || []).map((r: string) => REASON_LABEL[r] || r).join(', ') || 'not checked'}{q.requestedByExplorer ? ' · explorer asked for review' : ''}</p>
                  {q.kind === 'comment' && q.text && <p className="text-stone-700 bg-stone-50 rounded-lg p-2 break-words">“{q.text}”</p>}
                  {q.note && <p className="text-stone-600">“{q.note}”</p>}
                  <p className="text-xs text-stone-500">{when(q.createdAt)} · {q.userId ? <button onClick={() => openUser(q.userId)} className="underline">explorer</button> : 'explorer'}{q.kind !== 'comment' ? ` · ${q.published ? 'already in the feed' : `wants ${q.requestedFeed ? 'feed' : 'journal'}`}` : ''}</p>
                  <div className="flex gap-2 flex-wrap">
                    {q.kind === 'comment' ? (<>
                      <Btn tone="primary" onClick={() => decide(q.id, 'approve')}>Show note</Btn>
                      <Btn onClick={() => decide(q.id, 'reject')}>Keep hidden</Btn>
                    </>) : q.kind === 'unchecked' ? (<>
                      <Btn tone="primary" onClick={() => decide(q.id, 'approve')}>Looks fine</Btn>
                      <Btn onClick={() => decide(q.id, 'reject')}>Hide from feed</Btn>
                    </>) : (<>
                      <Btn tone="primary" onClick={() => decide(q.id, 'approve')}>Approve</Btn>
                      <Btn onClick={() => decide(q.id, 'reject')}>Keep private</Btn>
                    </>)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ReviewWords />
      <Card title="Reported by explorers">
        {!reported ? <p className="text-stone-600">Loading…</p> : reported.length === 0 ? <p className="text-stone-600">No reports.</p> : (
          <ul className="space-y-3">
            {reported.map(p => (
              <li key={p.id} className="border border-stone-200 rounded-xl p-3 flex gap-3">
                {(p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl) && <img src={p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl} alt="" className="w-24 h-24 rounded-lg object-cover bg-stone-100" />}
                <div className="flex-1 text-sm space-y-1">
                  <p className="font-semibold">{p.labels?.[0] || 'Sighting'} · <button onClick={() => openUser(p.userId)} className="underline font-normal">{p.userName}</button></p>
                  {p.caption && <p className="text-stone-700">{p.caption}</p>}
                  <p className="text-xs text-stone-500">{(p.reportReasons || []).map((r: any) => `${r.reason}${r.details ? ` (${r.details})` : ''}`).join(' · ')}</p>
                  <div className="flex gap-2 flex-wrap pt-1"><Btn onClick={() => act(p.id, 'dismiss')}>Report not valid</Btn><Btn onClick={() => act(p.id, 'hide')}>Hide from feed</Btn><Btn tone="danger" onClick={() => act(p.id, 'delete')}>Delete</Btn></div>
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
      {words === null ? <p className="text-stone-600">{msg || 'Loading…'}</p> : (<>
        <textarea value={words} onChange={e => setWords(e.target.value)} rows={3} aria-label="Review words" className="w-full border border-stone-300 rounded-xl p-3 text-sm" />
        <div className="flex items-center gap-3 mt-2"><Btn tone="primary" onClick={save}>Save words</Btn>{msg && <span role="status" className="text-sm text-stone-600">{msg}</span>}</div>
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
  if (!flags) return <p className="text-stone-600">{msg || 'Loading…'}</p>;
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
      {msg && <p role="status" className="text-sm rounded-xl bg-stone-100 p-3">{msg}</p>}
      <Card title="Feature flags and experiments" actions={<Btn tone="primary" onClick={save}>Save all</Btn>}>
        <p className="text-sm text-stone-600 mb-3">Rollout is the share of explorers who get the flag (0 to 100). With variants (for example <span className="font-mono">control:50, warm:50</span>) those explorers are split by weight. Each explorer always lands in the same group. The first time a flag is seen, the app records an <span className="font-mono">experiment_exposure</span> event (for explorers who allow analytics).</p>
        {Object.keys(flags).length === 0 && <p className="text-sm text-stone-600 mb-3">No flags yet. Every flag is off until it is added here.</p>}
        <ul className="space-y-3">
          {Object.entries(flags).map(([k, f]) => (
            <li key={k} className="border border-stone-200 rounded-xl p-3 grid gap-2 sm:grid-cols-[1fr_auto] items-start">
              <div className="space-y-2">
                <p className="font-mono text-sm font-semibold">{k}</p>
                <input value={f.description || ''} onChange={e => set(k, { description: e.target.value || undefined })} placeholder="What it changes" aria-label={`Description of ${k}`} className="w-full border border-stone-300 rounded-lg px-2.5 py-1.5 text-sm" />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled === true} onChange={e => set(k, { enabled: e.target.checked })} /> On</label>
                  <label className="flex items-center gap-2">Rollout <input type="number" min={0} max={100} value={f.rollout ?? 0} onChange={e => set(k, { rollout: Math.max(0, Math.min(100, Number(e.target.value))) })} className="w-20 border border-stone-300 rounded-lg px-2 py-1" />%</label>
                  <label className="flex items-center gap-2 flex-1 min-w-[220px]">Variants <input defaultValue={variantsText(f.variants)} onBlur={e => set(k, { variants: parseVariants(e.target.value) })} placeholder="none (simple on/off)" className="flex-1 border border-stone-300 rounded-lg px-2 py-1 font-mono text-xs" /></label>
                </div>
              </div>
              <Btn tone="danger" onClick={() => { if (confirm(`Remove ${k}? Everyone falls back to the default.`)) remove(k); }}>Remove</Btn>
            </li>
          ))}
        </ul>
        <form onSubmit={e => { e.preventDefault(); const k = name.trim(); if (!/^[a-z][a-z0-9_]{1,39}$/.test(k)) { setMsg('Flag names are lowercase letters, digits and underscores.'); return; } setFlags(f => ({ ...f!, [k]: { enabled: false, rollout: 0 } })); setName(''); }} className="flex gap-2 mt-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="new_flag_name" aria-label="New flag name" className="border border-stone-300 rounded-xl px-3 py-2 text-sm font-mono flex-1" />
          <Btn type="submit">Add flag</Btn>
        </form>
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
    if (!confirm('Add search keys to every sighting that is missing them? Safe to run more than once.')) return;
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
  return (
    <Card title="Exports and maintenance">
      <div className="flex flex-wrap gap-2">
        <Btn onClick={exportDwc} disabled={!!busy}>{busy === 'dwc' ? 'Exporting…' : 'Export Darwin Core Archive (GBIF)'}</Btn>
        <Btn onClick={backfill} disabled={!!busy}>{busy === 'search' ? 'Adding search keys…' : 'Add search keys to older sightings'}</Btn>
      </div>
      <p className="text-xs text-stone-500 mt-2">The archive holds public sightings with a scientific name only, licensed CC BY-NC 4.0, with coordinates rounded to 0.1° and withheld for sensitive species and for explorers who didn't share the place.</p>
      {msg && <p role="status" className="text-sm mt-2">{msg}</p>}
    </Card>
  );
};

const People: React.FC<{ uid: string | null; setUid: (u: string | null) => void }> = ({ uid, setUid }) => {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const search = useCallback(async (more = false) => {
    const p = new URLSearchParams({ limit: '25' });
    if (q.trim()) p.set('q', q.trim());
    if (more && next) p.set('after', next);
    try { const r = await api(`/users?${p}`); setList(l => (more ? [...l, ...r.items] : r.items)); setNext(r.next || null); } catch (e: any) { setMsg(e.message); }
  }, [q, next]);
  useEffect(() => { search(false); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (uid) { setDetail(null); api(`/users/${uid}`).then(setDetail).catch(e => setMsg(e.message)); } }, [uid]);
  const act = async (path: string, confirmText: string, body?: any) => {
    if (!confirm(confirmText)) return;
    try { await api(`/users/${uid}/${path}`, { method: 'POST', body }); setMsg('Done.'); setDetail(await api(`/users/${uid}`)); } catch (e: any) { setMsg(e.message); }
  };
  if (uid) {
    return (
      <div className="space-y-4">
        <Btn onClick={() => setUid(null)}>← All people</Btn>
        {msg && <p role="status" className="text-sm rounded-xl bg-stone-100 p-3">{msg}</p>}
        {!detail ? <p className="text-stone-600">Loading…</p> : (
          <>
            <Card title={detail.profile?.username || detail.auth?.email || uid}>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <p><span className="text-stone-500">Account:</span> <span className="font-mono text-xs">{uid}</span></p>
                <p><span className="text-stone-500">Email:</span> {detail.auth?.email || (detail.auth?.anonymous ? 'guest' : '–')} {detail.auth?.emailVerified ? '(verified)' : ''}</p>
                <p><span className="text-stone-500">Sign-in:</span> {detail.auth?.providers?.join(', ') || 'guest'}{detail.auth?.mfa ? ' · two-step on' : ''}</p>
                <p><span className="text-stone-500">Joined / last seen:</span> {detail.auth?.created} / {detail.auth?.lastSignIn}</p>
                <p><span className="text-stone-500">Today:</span> {detail.usageToday.identify || 0} identifications · {detail.usageToday.other || 0} other AI · {Math.ceil((detail.usageToday.liveMs || 0) / 60000)} live min · {detail.usageToday.posts || 0} shared</p>
                <p><span className="text-stone-500">Status:</span> {detail.suspended ? <span className="text-red-700 font-semibold">suspended ({detail.suspended.reason || 'no reason given'})</span> : 'active'}</p>
              </div>
              <div className="flex gap-2 flex-wrap mt-4">
                {detail.suspended
                  ? <Btn onClick={() => act('unsuspend', 'Lift the suspension?')}>Lift suspension</Btn>
                  : <Btn tone="danger" onClick={() => { const reason = prompt('Reason for suspending (shown in the audit log):'); if (reason !== null) act('suspend', 'Suspend this account and sign it out everywhere?', { reason }); }}>Suspend</Btn>}
                <Btn onClick={() => act('signout', 'Sign this account out on every device?')}>Sign out everywhere</Btn>
              </div>
            </Card>
            <Card title="Recent AI activity">
              {detail.aiLog.length === 0 ? <p className="text-sm text-stone-600">None in the last 30 days.</p> : (
                <ul className="text-xs divide-y divide-stone-100">{detail.aiLog.map((l: any) => <li key={l.id} className="py-1 flex gap-3"><span className="w-40 shrink-0">{when(l.at)}</span><span className="w-28">{l.task}</span><span>{l.status}</span><span className="text-amber-800">{Object.keys(l.flags || {}).filter(k => l.flags[k]).join(', ')}</span></li>)}</ul>
              )}
            </Card>
            <Card title="Recent sightings">
              <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2">{detail.posts.map((p: any) => (
                <li key={p.id} title={`${p.labels?.[0] || ''} · ${p.isPublic ? 'feed' : 'journal'} · ${p.moderation?.status || ''}`} className="relative">
                  {(p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl) ? <img src={p.thumbSmallUrl || p.thumbnailUrl || p.imageUrl} alt="" className="aspect-square w-full object-cover rounded-lg bg-stone-100" /> : <div className="aspect-square rounded-lg bg-stone-100 flex items-center justify-center text-xs">{p.mediaType}</div>}
                  {!p.isPublic && <span className="absolute top-1 left-1 text-[10px] bg-white/90 rounded px-1">journal</span>}
                </li>
              ))}</ul>
            </Card>
          </>
        )}
      </div>
    );
  }
  return (
    <Card actions={<form onSubmit={e => { e.preventDefault(); search(false); }} className="flex gap-2"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Username or email" aria-label="Search people" className="border border-stone-300 rounded-xl px-3 py-1.5 text-sm" /><Btn type="submit">Search</Btn></form>} title="People">
      {msg && <p className="text-sm text-red-700">{msg}</p>}
      <ul className="divide-y divide-stone-100">{list.map(u => (
        <li key={u.id}><button onClick={() => setUid(u.id)} className="w-full text-left py-2 flex justify-between gap-3 hover:bg-stone-50 px-2 rounded-lg"><span className="font-semibold text-sm">{u.username || u.email || u.id}</span><span className="text-xs text-stone-500">{u.stats ? `${u.stats.observations || 0} sightings` : ''} {u.joinedAt ? `· joined ${new Date(u.joinedAt).toLocaleDateString()}` : ''}</span></button></li>
      ))}</ul>
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
      <p className="text-sm text-stone-600">Letters are private. A conversation can be read here only after one of its participants reports it, and each reading is recorded in the audit log.</p>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
      <Card title="Reported conversations">
        {!items ? <p className="text-stone-600">Loading…</p> : items.length === 0 ? <p className="text-stone-600">No open reports.</p> : (
          <ul className="divide-y divide-stone-100">{items.map(r => (
            <li key={r.id} className="py-2 flex flex-wrap gap-2 items-center justify-between text-sm">
              <span>{when(r.createdAt)} · {r.reason}{r.details ? ` · ${r.details}` : ''}</span>
              <span className="flex gap-2">
                <Btn onClick={async () => { try { const m = await api(`/letters/${r.cid}`); setOpen({ cid: r.cid, msgs: m.items }); } catch (e: any) { setMsg(e.message); } }}>Read</Btn>
                <Btn onClick={async () => { await api(`/letters/${r.cid}/close`, { method: 'POST' }); setOpen(null); load(); }}>Close report</Btn>
              </span>
            </li>
          ))}</ul>
        )}
      </Card>
      {open && (
        <Card title="Conversation" actions={<Btn onClick={() => setOpen(null)}>Close</Btn>}>
          <ul className="space-y-2 text-sm">{open.msgs.map(m => <li key={m.id}><span className="font-mono text-xs text-stone-500">{String(m.senderId).slice(0, 8)} · {when(m.createdAt)}</span><p>{m.text}</p></li>)}</ul>
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
      <Card>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-sm">Collection<select value={col} onChange={e => setCol(e.target.value)} className="mt-1 block border border-stone-300 rounded-xl px-3 py-2">{COLLECTIONS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="text-sm">Field<input value={where} onChange={e => setWhere(e.target.value)} placeholder="e.g. userId" className="mt-1 block border border-stone-300 rounded-xl px-3 py-2" /></label>
          <label className="text-sm">equals<input value={equals} onChange={e => setEquals(e.target.value)} className="mt-1 block border border-stone-300 rounded-xl px-3 py-2" /></label>
          <Btn onClick={() => load(false)}>Look</Btn>
          <Btn onClick={download} disabled={!items.length}>Download JSON</Btn>
        </div>
        <p className="text-xs text-stone-500 mt-2">Read only. Letters are not listed here.</p>
      </Card>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={`${items.length} documents`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-stone-500"><th className="py-1 pr-2">id</th>{columns.map(c => <th key={c} className="pr-2">{c}</th>)}</tr></thead>
              <tbody>{items.map(it => (
                <tr key={it.id} onClick={() => setSel(it)} className={`border-t border-stone-100 cursor-pointer hover:bg-stone-50 ${sel?.id === it.id ? 'bg-emerald-50' : ''}`}>
                  <td className="py-1 pr-2 font-mono">{it.id.slice(0, 12)}</td>{columns.map(c => <td key={c} className="pr-2">{cell(it[c])}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {next && <Btn className="mt-3" onClick={() => load(true)}>Load more</Btn>}
        </Card>
        <Card title={sel ? sel.id : 'Pick a document'}>{sel ? <Json value={sel} /> : <p className="text-sm text-stone-600">Its full contents appear here.</p>}</Card>
      </div>
      <Card title="One-off tools">
        <p className="text-sm text-stone-600 mb-2">Move precise locations from older public sightings into each explorer's private records.</p>
        <Btn onClick={async () => { try { const c = await FirebaseService.migratePublicLocationsToPrivate((d, t) => setMigrating(`${d}/${t}`)); setMigrating(`Done: ${c} sightings secured.`); } catch (e: any) { setMigrating(e.message); } }}>Run privacy migration</Btn>
        {migrating && <span className="ml-3 text-sm">{migrating}</span>}
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
    if (!confirm(sec.requireAdminMfa ? 'Stop requiring two-step sign-in for the admin console?' : 'Require two-step sign-in for the admin console? Make sure your account has it set up first, or you will be locked out until it is.')) return;
    try { await api('/settings', { method: 'PUT', body: { requireAdminMfa: !sec.requireAdminMfa } }); load(); } catch (e: any) { setMsg(e.message); }
  };
  if (!sec) return <p className="text-stone-600">{msg || 'Loading…'}</p>;
  const extra = sec.adminHolders.length !== 1;
  return (
    <div className="space-y-4">
      {msg && <p role="status" className="text-sm rounded-xl bg-stone-100 p-3">{msg}</p>}
      <Card title="Who is admin">
        {extra && <p role="alert" className="mb-2 text-sm rounded-xl bg-red-50 border border-red-200 p-3 text-red-900">{sec.adminHolders.length} accounts hold the admin claim. Run scripts/set-admin.mjs to leave exactly one.</p>}
        <ul className="text-sm space-y-1">{sec.adminHolders.map((h: any) => <li key={h.uid}>{h.email} <span className="font-mono text-xs text-stone-500">{h.uid}</span> · two-step {h.mfa ? 'on' : 'off'} · last sign-in {h.lastSignIn}</li>)}</ul>
        <p className="text-xs text-stone-500 mt-2">The server also requires the account named in ADMIN_UIDS ({sec.namedAdmin.uids ? sec.namedAdmin.uids.join(', ') : `email ${sec.namedAdmin.email}; set ADMIN_UIDS to pin it`}), a verified email, a sign-in within {sec.sessionHours} hours, and a token that hasn't been revoked.</p>
        <div className="mt-3 flex items-center gap-3"><Btn onClick={mfa}>{sec.requireAdminMfa ? 'Two-step sign-in required (turn off)' : 'Require two-step sign-in'}</Btn></div>
      </Card>
      <Card title="Blocked networks">
        <form onSubmit={e => { e.preventDefault(); if (prefix.trim()) block(false); }} className="flex gap-2 mb-3"><input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="IP address or prefix, e.g. 203.0.113." aria-label="Network to block" className="border border-stone-300 rounded-xl px-3 py-2 text-sm flex-1" /><Btn type="submit" tone="danger">Block</Btn></form>
        {sec.blockedNetworks.length === 0 ? <p className="text-sm text-stone-600">None.</p> : <ul className="text-sm space-y-1">{sec.blockedNetworks.map((p: string) => <li key={p} className="flex justify-between"><span className="font-mono">{p}</span><button onClick={() => block(true, p)} className="underline">Unblock</button></li>)}</ul>}
      </Card>
      <Card title="Server">
        <ul className="text-sm space-y-1">
          <li>Database from the server: {sec.store.ok ? 'reachable' : `not reachable (${sec.store.error})`}</li>
          <li>Separate service account: {sec.env.serviceAccount ? 'yes' : 'no (uses the runtime account)'}</li>
          <li>Allowances when the database is down: {sec.env.quotaFailOpen ? <b className="text-red-700">allowed (development setting, turn off)</b> : 'refused (safe)'}</li>
          <li>App Check: {sec.runtime?.appCheck ? `${sec.runtime.appCheck.mode} (since restart: ${sec.runtime.appCheck.ok} verified, ${sec.runtime.appCheck.missing} without a token, ${sec.runtime.appCheck.invalid} invalid)` : sec.env.appCheck}</li>
          {sec.runtime?.leases && <li>Live sessions counted across servers: {sec.runtime.leases.shared ? 'yes' : <b className="text-amber-800">no, this server counts on its own{sec.runtime.leases.lastError ? ` (${sec.runtime.leases.lastError})` : ''}</b>}</li>}
          {sec.runtime && <li>Live connection: {sec.runtime.liveDirect ? 'direct to Gemini with one-use tokens' : 'through this server'}</li>}
          {sec.runtime && <li>When the image check is down: {sec.runtime.moderationFailOpen ? 'publish and queue for a look' : 'hold for review'}</li>}
        </ul>
      </Card>
      <Card title="Audit log (every admin action)">
        <ul className="text-xs divide-y divide-stone-100">{auditRows.map(a => <li key={a.id} className="py-1.5 flex flex-wrap gap-x-3"><span className="w-40 shrink-0">{when(a.at)}</span><span className="font-semibold">{a.action}</span><span className="text-stone-600 break-all">{JSON.stringify(a.details)}</span><span className="text-stone-400">{a.ip}</span></li>)}</ul>
        {before && <Btn className="mt-3" onClick={async () => { const r = await api(`/audit?before=${before}`); setAudit(x => [...x, ...r.items]); setBefore(r.before); }}>Load older</Btn>}
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

  if (state !== 'ok') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <span className="material-symbols-outlined text-4xl text-stone-400" aria-hidden="true">admin_panel_settings</span>
          <p className="text-stone-800">
            {state === 'checking' ? 'Checking access…'
              : state === 'reauth' ? 'For safety, sign out and sign in again to open the admin console.'
              : state === 'mfa' ? 'The admin console needs two-step sign-in on this account.'
              : why || 'This area is for the NatureGram admin.'}
          </p>
          <Btn onClick={onBack}>Back</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="sticky top-0 z-10 bg-white border-b border-stone-200 safe-pt">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={onBack} aria-label="Back to the app" className="w-10 h-10 -ml-2 rounded-full hover:bg-stone-100 flex items-center justify-center"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
          <h1 className="font-bold">NatureGram admin</h1>
          <span className="ml-auto text-xs text-stone-500 truncate">{me?.email}</span>
        </div>
        <nav aria-label="Admin sections" className="max-w-7xl mx-auto px-2 flex gap-1 overflow-x-auto no-scrollbar">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => { setSection(s.id); if (s.id !== 'people') setUid(null); }} aria-current={section === s.id ? 'page' : undefined}
              className={`shrink-0 px-3 py-2.5 text-sm font-semibold border-b-2 flex items-center gap-1.5 ${section === s.id ? 'border-emerald-800 text-emerald-900' : 'border-transparent text-stone-600 hover:text-stone-900'}`}>
              <span className="material-symbols-outlined text-lg" aria-hidden="true">{s.icon}</span>{s.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="max-w-7xl mx-auto p-4 pb-16">
        {section === 'overview' && <Overview go={setSection} />}
        {section === 'controls' && <Controls />}
        {section === 'ai' && <AiGovernance />}
        {section === 'monitor' && <Monitor openUser={openUser} />}
        {section === 'review' && <Review openUser={openUser} />}
        {section === 'people' && <People uid={uid} setUid={setUid} />}
        {section === 'letters' && <Letters />}
        {section === 'experiments' && <Experiments />}
        {section === 'data' && <div className="space-y-4"><DataTools /><DataExplorer /></div>}
        {section === 'security' && <Security />}
      </main>
    </div>
  );
};

export default AdminConsole;
