import React, { useMemo } from 'react';

/**
 * NatureGram's appreciation gesture. Explorers don't "like" a sighting, they marvel at it.
 * The glyph is a small starburst rather than a heart, and the double-tap response is a drift
 * of fireflies rising from the point of the tap instead of a stamped icon.
 */
export const WONDER_ICON = 'flare';

/** Filled/unfilled Wonder glyph, sized by className. */
export const WonderIcon: React.FC<{ active?: boolean; className?: string }> = ({ active, className = 'text-[22px]' }) => (
  <span
    className={`material-symbols-outlined ${className} transition-transform duration-300 ${active ? 'scale-110' : ''}`}
    style={active ? { fontVariationSettings: "'FILL' 1, 'wght' 500" } : { fontVariationSettings: "'FILL' 0, 'wght' 300" }}
    aria-hidden="true"
  >{WONDER_ICON}</span>
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
export const fieldMoment = (d: Date = new Date()): { name: string; hint: string; icon: string } => {
  const h = d.getHours();
  if (h >= 4 && h < 7) return { name: 'Dawn chorus', hint: 'Birdsong peaks around first light. Step outside and just listen.', icon: 'wb_twilight' };
  if (h >= 7 && h < 11) return { name: 'Morning', hint: 'Butterflies and bees take wing once the sun has warmed them.', icon: 'emoji_nature' };
  if (h >= 11 && h < 15) return { name: 'Midday', hint: 'Look up: hawks and kites ride the rising warm air over open ground.', icon: 'flutter_dash' };
  if (h >= 15 && h < 18) return { name: 'Afternoon', hint: 'As the heat eases, many birds return to feed before dusk.', icon: 'forest' };
  if (h >= 18 && h < 20) return { name: 'Dusk', hint: 'Bats and nightjars begin hunting as the light fades.', icon: 'wb_twilight' };
  return { name: 'Night', hint: 'Owls call and moths gather at lights. The night shift is on.', icon: 'dark_mode' };
};

/** Capture placeholders ("Captured photo.", "Uploaded media.") aren't observations; don't show them as if they were. */
export const observedBehaviour = (b?: string | null): string | null => {
  const t = (b || '').trim();
  if (!t || /^(captured|uploaded|recorded)\s+(photo|media|video|audio|sound)\.?$/i.test(t)) return null;
  return t;
};
