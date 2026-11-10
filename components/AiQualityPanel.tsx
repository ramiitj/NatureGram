import React, { useEffect, useMemo, useState } from 'react';
import Glyph from './Glyph';
import { PressingLoader } from './SkeletonPost';
/**
 * Identification quality (admin): accuracy measured from what explorers change before publishing.
 * Prompts and models are edited in the admin console's AI governance section.
 */
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');

const AiQualityPanel: React.FC<{ load: () => Promise<any[]> }> = ({ load }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { load().then(setRows).catch(e => setError(e.message)); }, [load]);

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

  const card = 'bg-[#fffdf8] border border-[#e3d8c4] rounded-md p-4 sm:p-5 shadow-[0_1px_2px_rgba(60,40,20,0.06)] min-w-0';
  const th = 'py-1.5 pr-3 font-medium text-stone-500 whitespace-nowrap';
  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} flex items-start gap-3`}>
        <Glyph name="guide" size={26} className="text-theme-accent mt-0.5" />
        <div className="min-w-0">
          <h3 className="font-display text-xl text-stone-900">Identification quality</h3>
          <p className="text-sm text-stone-600 mt-1">Accuracy is measured by what explorers change before publishing (human-in-the-loop). A well-calibrated guide is corrected rarely at "high" confidence and often at "low".</p>
        </div>
      </div>

      {error && <p role="alert" className="text-sm rounded-md px-3.5 py-2.5 border bg-amber-50 border-amber-300 text-amber-950">{error}</p>}
      {!stats ? (!error && <PressingLoader label="Reading what explorers corrected" className="py-10" />) : stats.total === 0 ? (
        <div className={`${card} py-8 flex flex-col items-center text-center`}>
          <Glyph name="guide" size={36} strokeWidth={1.2} className="text-[#b9a98a] mb-2" />
          <p className="font-display italic text-[17px] text-stone-700">No reviewed identifications yet.</p>
          <p className="text-sm text-stone-500 mt-1 max-w-sm">Figures appear once explorers publish sightings the guide named.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Reviewed identifications', String(stats.total)],
              ['Correction rate', pct(stats.corrected, stats.total)],
              ['Flagged for expert review', pct(stats.review, stats.total)],
              ['Sensitive species (locations hidden)', String(stats.sensitive)],
            ].map(([k, v]) => (
              <div key={k} className="bg-[#fffdf8] border border-[#e3d8c4] rounded-md p-3.5 sm:p-4">
                <p className="text-[13px] text-stone-600 leading-snug">{k}</p>
                <p className="text-2xl font-semibold text-stone-900 mt-1 tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className={card}>
              <h3 className="font-display text-lg text-stone-900 mb-3">Calibration by stated confidence</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-stone-800">
                  <thead><tr className="text-left"><th className={th}>Confidence</th><th className={`${th} text-right`}>Reviewed</th><th className={`${th} text-right`}>Corrected</th><th className={`${th} text-right`}>Correction rate</th></tr></thead>
                  <tbody>
                    {['high', 'medium', 'low', 'unknown'].filter(c => stats.byConf[c]).map(c => (
                      <tr key={c} className="border-t border-[#e8dfcd] tabular-nums"><td className="py-1.5 pr-3 font-medium capitalize">{c}</td><td className="pr-3 text-right">{stats.byConf[c].n}</td><td className="pr-3 text-right">{stats.byConf[c].c}</td><td className="pr-3 text-right">{pct(stats.byConf[c].c, stats.byConf[c].n)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-stone-500 mt-3">Target: high under 10%, medium under 30%. If "high" is corrected often, the guide is overconfident. Tighten the identify prompt or change its model under AI governance.</p>
            </div>
            <div className={card}>
              <h3 className="font-display text-lg text-stone-900 mb-3">By media type</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-stone-800">
                  <thead><tr className="text-left"><th className={th}>Media</th><th className={`${th} text-right`}>Reviewed</th><th className={`${th} text-right`}>Correction rate</th></tr></thead>
                  <tbody>
                    {Object.entries(stats.byMedia).map(([m, v]) => (
                      <tr key={m} className="border-t border-[#e8dfcd] tabular-nums"><td className="py-1.5 pr-3 font-medium capitalize">{m}</td><td className="pr-3 text-right">{v.n}</td><td className="pr-3 text-right">{pct(v.c, v.n)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-stone-500 mt-3 tabular-nums">Safety flags seen: fungi {stats.fungi}, people visible {stats.people}.</p>
            </div>
          </div>

          <div className={card}>
            <h3 className="font-display text-lg text-stone-900 mb-3">Most common corrections (guide → explorer)</h3>
            {stats.confusions.length === 0 ? <p className="text-sm font-display italic text-stone-500">No corrections yet. The guide and the explorers agree.</p> : (
              <ol className="text-sm divide-y divide-[#e8dfcd]">
                {stats.confusions.map(([k, n], i) => <li key={k} className="py-1.5 flex items-baseline gap-3"><span className="w-5 text-right text-stone-400 tabular-nums">{i + 1}</span><span className="flex-1 min-w-0 break-words text-stone-900">{k}</span><span className="text-stone-500 tabular-nums">×{n}</span></li>)}
              </ol>
            )}
          </div>
        </>
      )}

    </div>
  );
};

export default AiQualityPanel;
