import React, { useEffect, useMemo, useState } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { GeminiConfig } from '../types';

/**
 * AI governance dashboard (admin): measures identification accuracy from
 * human-in-the-loop feedback and manages the live guide's instructions.
 */
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');

const AiQualityPanel: React.FC<{ config: GeminiConfig | null; onConfigSaved: (c: GeminiConfig) => void }> = ({ config, onConfigSaved }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(config?.systemInstruction || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState('');

  useEffect(() => { FirebaseService.getAiFeedback(1000).then(setRows).catch(e => setError(e.message)); }, []);
  useEffect(() => { setDraft(config?.systemInstruction || ''); }, [config?.systemInstruction]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const total = rows.length;
    const corrected = rows.filter(r => r.kind === 'correction').length;
    const byConf: Record<string, { n: number; c: number }> = {};
    const byMedia: Record<string, { n: number; c: number }> = {};
    const confusions = new Map<string, number>();
    let review = 0, sensitive = 0, people = 0, fungi = 0;
    rows.forEach(r => {
      const conf = r.confidence || 'unknown';
      byConf[conf] = byConf[conf] || { n: 0, c: 0 }; byConf[conf].n++;
      const m = r.mediaType || 'unknown';
      byMedia[m] = byMedia[m] || { n: 0, c: 0 }; byMedia[m].n++;
      if (r.kind === 'correction') {
        byConf[conf].c++; byMedia[m].c++;
        const k = `${r.aiLabels?.[0] || '?'} → ${r.humanLabels?.[0] || '?'}`;
        confusions.set(k, (confusions.get(k) || 0) + 1);
      }
      if (r.needsExpertReview) review++;
      if (r.flags?.sensitiveSpecies) sensitive++;
      if (r.flags?.peopleVisible) people++;
      if (r.flags?.fungi) fungi++;
    });
    return { total, corrected, byConf, byMedia, confusions: [...confusions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), review, sensitive, people, fungi };
  }, [rows]);

  const saveInstructions = async () => {
    if (!config) return;
    if (!note.trim()) { setSaving('Add a short change note so the change is auditable.'); return; }
    setSaving('Saving…');
    try {
      const next = { ...config, systemInstruction: draft };
      await FirebaseService.updateGeminiConfigAudited(next, note.trim());
      onConfigSaved(next);
      setNote('');
      setSaving('Saved. The server still appends the non-negotiable platform policy.');
    } catch (e: any) { setSaving('Save failed: ' + (e?.message || 'permission denied')); }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div className="bg-white shadow-sm border border-stone-200 rounded-2xl p-6">
        <h2 className="text-2xl font-bold text-stone-900">AI quality & governance</h2>
        <p className="text-sm text-stone-600 mt-1">Accuracy is measured by what explorers change before publishing (human-in-the-loop). A well-calibrated system is corrected rarely at "high" confidence and often at "low".</p>
      </div>

      {error && <p className="text-red-700">{error}</p>}
      {!stats ? <p className="text-stone-600">Loading feedback…</p> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['Reviewed identifications', String(stats.total)],
              ['Correction rate', pct(stats.corrected, stats.total)],
              ['Flagged for expert review', pct(stats.review, stats.total)],
              ['Sensitive species (locations hidden)', String(stats.sensitive)],
            ].map(([k, v]) => (
              <div key={k} className="bg-white border border-stone-200 rounded-2xl p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-stone-500">{k}</p>
                <p className="text-3xl font-bold text-stone-900 mt-1 tabular">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-stone-200 rounded-2xl p-5">
              <h3 className="font-bold text-stone-900 mb-3">Calibration by stated confidence</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-stone-500"><th className="py-1">Confidence</th><th>Reviewed</th><th>Corrected</th><th>Correction rate</th></tr></thead>
                <tbody>
                  {['high', 'medium', 'low', 'unknown'].filter(c => stats.byConf[c]).map(c => (
                    <tr key={c} className="border-t border-stone-100"><td className="py-1.5 font-semibold capitalize">{c}</td><td className="tabular">{stats.byConf[c].n}</td><td className="tabular">{stats.byConf[c].c}</td><td className="tabular">{pct(stats.byConf[c].c, stats.byConf[c].n)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-stone-500 mt-3">Target: high &lt; 10%, medium &lt; 30%. If "high" is corrected often, the model is overconfident. Tighten the prompt or switch MODEL_IDENTIFY.</p>
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl p-5">
              <h3 className="font-bold text-stone-900 mb-3">By media type</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-stone-500"><th className="py-1">Media</th><th>Reviewed</th><th>Correction rate</th></tr></thead>
                <tbody>
                  {Object.entries(stats.byMedia).map(([m, v]) => (
                    <tr key={m} className="border-t border-stone-100"><td className="py-1.5 font-semibold capitalize">{m}</td><td className="tabular">{v.n}</td><td className="tabular">{pct(v.c, v.n)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-stone-500 mt-3">Safety flags seen: fungi {stats.fungi}, people visible {stats.people}.</p>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <h3 className="font-bold text-stone-900 mb-3">Most common corrections (AI → explorer)</h3>
            {stats.confusions.length === 0 ? <p className="text-sm text-stone-600">No corrections yet.</p> : (
              <ol className="list-decimal list-inside text-sm space-y-1">
                {stats.confusions.map(([k, n]) => <li key={k}><span className="font-semibold">{k}</span> <span className="text-stone-500">×{n}</span></li>)}
              </ol>
            )}
          </div>
        </>
      )}

      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-stone-900">Live guide instructions</h3>
        <p className="text-sm text-stone-600">Model requested: <code className="bg-stone-100 px-1.5 rounded">{config?.model}</code>. The server pins the actual model to an allow-list and always appends the platform policy (accuracy, uncertainty, safety, wildlife ethics, privacy). Edits here cannot override it.</p>
        <label className="block">
          <span className="sr-only">Live guide instructions</span>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={12} className="w-full font-mono text-xs bg-stone-50 border border-stone-200 rounded-xl p-3" />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-stone-700 mb-1">Change note (required, kept in the audit log)</span>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm" placeholder="e.g. Ask the guide to mention look-alike species for warblers" />
        </label>
        <div className="flex items-center gap-3">
          <button onClick={saveInstructions} className="px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-bold">Save instructions</button>
          {saving && <span role="status" className="text-sm text-stone-600">{saving}</span>}
        </div>
      </div>
    </div>
  );
};

export default AiQualityPanel;
