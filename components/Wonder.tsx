import React, { useMemo } from 'react';
import type { GlyphName } from './Glyph.tsx';

/**
 * NatureGram's appreciation gesture. Explorers don't "like" a sighting, they marvel at it.
 * The glyph is a spark rather than a heart, and the double-tap response is a drift
 * of fireflies rising from the point of the tap instead of a stamped icon.
 */
export const WONDER_ICON = 'spark';

/** Filled/unfilled Wonder spark, sized by className (it follows the text size, e.g. text-[20px]). */
export const WonderIcon: React.FC<{ active?: boolean; className?: string }> = ({ active, className = 'text-[22px]' }) => (
  <span className={`inline-flex ${className} transition-transform duration-300 ${active ? 'scale-110' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 1.4 : 1.6} strokeLinejoin="round">
      <path d="M12 3.5c.6 4.4 2.2 6 6.5 6.5-4.3.5-5.9 2.1-6.5 6.5-.6-4.4-2.2-6-6.5-6.5 4.3-.5 5.9-2.1 6.5-6.5z" />
      {active && <><circle cx="18.6" cy="17.6" r="1.1" stroke="none" /><circle cx="5.6" cy="18.4" r=".8" stroke="none" /></>}
    </svg>
  </span>
);

/**
 * Fireflies that rise and fade where the explorer double-tapped. Purely decorative; screen readers
 * get the state change from the Wonder button itself. Collapses to nothing under reduced motion.
 */
export const WonderBurst: React.FC<{ x?: number; y?: number; count?: number }> = ({ x, y, count = 14 }) => {
  const flies = useMemo(() => Array.from({ length: count }, (_, i) => {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.1;
    const dist = 60 + Math.random() * 110;
    return {
      key: i,
      dx: `${Math.cos(angle) * dist}px`,
      dy: `${Math.sin(angle) * dist - 30}px`,
      size: 4 + Math.random() * 5,
      delay: `${Math.random() * 180}ms`,
      dur: `${900 + Math.random() * 700}ms`,
    };
  }), [count]);

  const pos: React.CSSProperties = x !== undefined && y !== undefined
    ? { left: x, top: y }
    : { left: '50%', top: '50%' };

  return (
    <span className="pointer-events-none absolute inset-0 z-[190] overflow-hidden" aria-hidden="true">
      <span className="absolute" style={pos}>
        <span className="wonder-glow absolute -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full" />
        {flies.map(f => (
          <span
            key={f.key}
            className="firefly absolute rounded-full"
            style={{
              width: f.size, height: f.size, marginLeft: -f.size / 2, marginTop: -f.size / 2,
              ['--dx' as any]: f.dx, ['--dy' as any]: f.dy,
              animationDelay: f.delay, animationDuration: f.dur,
            }}
          />
        ))}
      </span>
    </span>
  );
};

/** "12 marvelled", phrased for screen readers and small labels. */
export const wonderLabel = (n: number) => n === 0 ? 'Be the first to marvel' : `${n.toLocaleString()} marvelled`;

/**
 * What the living world is doing right now, by the explorer's local hour. A quiet nudge to look
 * up from the screen. Kept to well-established, general patterns so it holds true almost anywhere.
 */
export const fieldMoment = (d: Date = new Date()): { name: string; hint: string; icon: GlyphName } => {
  const h = d.getHours();
  if (h >= 4 && h < 7) return { name: 'Dawn chorus', hint: 'birdsong peaks now', icon: 'dawn' };
  if (h >= 7 && h < 11) return { name: 'Morning', hint: 'butterflies are warming up', icon: 'insect' };
  if (h >= 11 && h < 15) return { name: 'Midday', hint: 'raptors ride the thermals', icon: 'bird' };
  if (h >= 15 && h < 18) return { name: 'Afternoon', hint: 'birds feed before dusk', icon: 'sun' };
  if (h >= 18 && h < 20) return { name: 'Dusk', hint: 'bats begin to hunt', icon: 'dawn' };
  return { name: 'Night', hint: 'owls are calling', icon: 'moon' };
};

/** Capture placeholders ("Captured photo.", "Uploaded media.") aren't observations; don't show them as if they were. */
export const observedBehaviour = (b?: string | null): string | null => {
  const t = wholeSentences(b);
  if (!t || /^(captured|uploaded|recorded)\s+(photo|media|video|audio|sound)\.?$/i.test(t)) return null;
  return t;
};

/**
 * Text that was cut short when it was stored ("…in ritualised sparring. This b...") reads as broken.
 * Keep only the whole sentences; if there is no whole sentence, end at the last whole word with an ellipsis.
 */
export const wholeSentences = (b?: string | null): string => {
  const t = (b || '').trim();
  if (!/(\.\.\.|…)$/.test(t)) return t;
  const body = t.replace(/(\.\.\.|…)$/, '').trimEnd();
  const lastStop = Math.max(body.lastIndexOf('. '), body.lastIndexOf('! '), body.lastIndexOf('? '));
  if (lastStop > 20) return body.slice(0, lastStop + 1);
  const lastSpace = body.lastIndexOf(' ');
  return (lastSpace > 0 ? body.slice(0, lastSpace) : body).replace(/[,;:]$/, '') + '…';
};

/** The first sentence only: a brief line for places where there is room for one thought (Moments). */
export const firstSentence = (b?: string | null): string => {
  const t = wholeSentences(b);
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t).trim();
};

const normWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The behaviour note, minus sentences that only repeat the behaviour line already shown above it,
 * so the second telling always adds something new. Returns paragraphs.
 */
export const insightBeyond = (insight?: string | null, behaviour?: string | null): string[] => {
  if (!insight) return [];
  const seen = normWords(behaviour || '');
  const repeats = (sentence: string) => {
    if (!seen) return false;
    const k = normWords(sentence).slice(0, 48);
    return k.length > 12 && (seen.includes(k) || k.includes(seen.slice(0, 48)));
  };
  return insight.split(/\n+/).map(p => {
    const sentences = p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [p];
    return sentences.filter(x => !repeats(x)).join('').trim();
  }).filter(Boolean);
};

/**
 * A picture for a sound: soft bars that breathe while the recording plays and rest when it stops.
 * Used for sound sightings with no photo and for video files that carry only audio.
 */
export const SoundScape: React.FC<{ label?: string | null; playing?: boolean; className?: string }> = ({ label, playing, className = '' }) => {
  const bars = Array.from({ length: 32 }, (_, i) => 18 + Math.round(42 * Math.abs(Math.sin(i * 0.62) * Math.cos(i * 0.21))));
  return (
    <div className={`relative w-full rounded-2xl bg-gradient-to-b from-stone-700 to-stone-950 text-white flex flex-col items-center justify-center gap-5 px-6 py-8 overflow-hidden ${className}`}>
      <div className="flex items-center gap-[3px] h-24" aria-hidden="true">
        {bars.map((h, i) => (
          <span
            key={i}
            className={`w-[5px] rounded-full bg-white/70 ${playing ? 'animate-wave-bar' : ''}`}
            style={{ height: `${h}%`, animationDelay: `${(i % 8) * 110}ms`, animationDuration: `${900 + (i % 5) * 170}ms` }}
          />
        ))}
      </div>
      {label && <p className="font-display italic text-xl text-center leading-tight">{label}</p>}
    </div>
  );
};

/** ISO-week key such as "2026-W46", used to show the field letter once a week. */
export const weekKey = (d: Date = new Date()): string => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
};

const SOUTHERN_TZ = /^(Australia|Antarctica|Pacific\/(Auckland|Chatham|Fiji|Noumea)|America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima)|Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Blantyre)|Indian\/(Mauritius|Reunion|Antananarivo))/;

// What the living world is doing this month, written for the northern hemisphere; shifted six months in the south.
const SEASON_NOTES = [
  'Winter visitors are on lakes and wetlands: ducks, cranes and wagtails that bred far to the north.',
  'Many resident birds begin courting. Dawn songs grow longer and more varied.',
  'Trees flower before the heat. Watch sunbirds, bees and butterflies working the blossoms.',
  'Migrants are on the move northward, so a wetland can change from one week to the next.',
  'Heat sends animals to water at dawn and dusk. A quiet spot near a waterhole is the best hide.',
  'Early rains wake frogs and insects in many places. Listen after dark for the chorus.',
  'Fungi and new shoots follow the rain. Look low on the forest floor, and never eat a wild mushroom.',
  'Butterflies gather on damp ground to drink minerals. Check the edges of puddles on sunny mornings.',
  'Orb-weaving spiders build their biggest webs now. Early dew makes them easy to find.',
  'Migrants start arriving from the north. Scan open water, fields and wetland edges.',
  'Cooler days bring raptors and winter flocks. Scan the sky mid-morning as the air warms.',
  'Long nights: many owls call more often now as they settle territories. Listen after dusk.',
];

/** This month's note for the explorer's hemisphere (guessed from their time zone). */
export const seasonNote = (d: Date = new Date()): string => {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* unknown */ }
  const m = (d.getMonth() + (SOUTHERN_TZ.test(tz) ? 6 : 0)) % 12;
  return SEASON_NOTES.at(m) || SEASON_NOTES[0];
};
