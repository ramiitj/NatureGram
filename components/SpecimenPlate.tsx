import React from 'react';
import Glyph from './Glyph';
import { GROUP_GLYPH, LifeEntry, fieldDate } from '../services/lifeList';

/**
 * A specimen plate: one species presented the way a herbarium sheet or a field-guide plate would be.
 * Cream card, one fine rule, the photograph mounted in the middle, the common name in serif italic,
 * the scientific name beneath, and the date, place and season of the first meeting along the foot.
 * The same plate is reused by the life list, the Lens, the publish celebration and sharing.
 */
export interface PlateData {
  name: string;
  scientific?: string;
  thumb?: string;
  no?: number;
  firstMs?: number;
  place?: string;
  season?: string;
  group?: LifeEntry['group'];
  count?: number;
  /** A sound recording: drawn as a waveform when there is no photograph */
  sound?: boolean;
}

/** A recording drawn as a waveform (the plate's photo box for sounds). */
const SoundMotif: React.FC<{ seed: string }> = ({ seed }) => {
  const offset = Array.from(seed || 'sound').reduce((n, c) => n + c.charCodeAt(0), 0) % 7;
  const bars = Array.from({ length: 16 }, (_, i) => 18 + Math.round(72 * Math.abs(Math.sin((i + offset) * 0.62) * Math.cos((i + offset) * 0.21))));
  return (
    <span className="w-full h-full bg-gradient-to-b from-stone-700 to-stone-900 flex items-center justify-center" aria-hidden="true">
      <span className="flex items-center justify-center gap-[3px] h-1/2 w-3/4">
        {bars.map((h, i) => <span key={i} className="w-[3px] rounded-full bg-white/70" style={{ height: `${h}%` }} />)}
      </span>
    </span>
  );
};

export const plateFoot = (d: PlateData) =>
  [d.firstMs ? fieldDate(d.firstMs) : '', d.place, d.season].filter(Boolean).join(' · ');

export const SpecimenPlate: React.FC<{
  data: PlateData;
  size?: 'sm' | 'md' | 'lg';
  stamp?: React.ReactNode;
  ghost?: boolean;
  onClick?: () => void;
  className?: string;
}> = ({ data, size = 'md', stamp, ghost, onClick, className = '' }) => {
  const Tag: any = onClick ? 'button' : 'div';
  const pad = size === 'sm' ? 'p-2' : size === 'lg' ? 'p-4' : 'p-2.5';
  const nameCls = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-[28px]' : 'text-base';
  return (
    <Tag
      onClick={onClick}
      aria-label={onClick ? `${data.name}${data.no ? `, number ${data.no} on the list` : ''}` : undefined}
      className={`relative text-left w-full rounded-md ${pad} ${ghost ? 'bg-transparent border border-dashed border-stone-300' : 'bg-[#fbf7ef] border border-[#e8dfcd]'} ${onClick ? 'transition-colors hover:border-[#d8ccb6]' : ''} ${className}`}
    >
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-1 pb-1.5 font-display italic text-xs text-stone-500">
          <span>{data.no ? `No. ${data.no}` : ' '}</span>
          {data.group && <Glyph name={GROUP_GLYPH[data.group]} size={14} className="text-stone-400" />}
        </div>
        <div className={`aspect-[4/3] overflow-hidden rounded-[3px] ${ghost ? 'bg-stone-100/60' : 'bg-[#f3efe7]'} flex items-center justify-center`}>
          {data.thumb && !ghost
            ? <img src={data.thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            : data.sound && !ghost
              ? <SoundMotif seed={data.name} />
              : <Glyph name={data.group ? GROUP_GLYPH[data.group] : 'seedling'} size={size === 'lg' ? 40 : 24} strokeWidth={1.2} className="text-stone-400/70" />}
        </div>
        <div className="px-1 pt-2 flex-1 flex flex-col">
          <p className={`font-display italic leading-snug ${nameCls} ${ghost ? 'text-stone-400' : 'text-stone-900'} line-clamp-2`}>{data.name}</p>
          {data.scientific && size !== 'sm' && <p className="font-display italic text-xs text-stone-500 truncate">{data.scientific}</p>}
          {!ghost && plateFoot(data) && <p className="mt-auto pt-1.5 text-[11px] leading-snug text-stone-500">{plateFoot(data)}</p>}
        </div>
      </div>
      {stamp && <div className="absolute -top-2 -right-2 rotate-[8deg]">{stamp}</div>}
    </Tag>
  );
};

/** A round ink stamp ("First for your list", "25th species", "Answers Darwin's challenge"): serif italic on the paper, ringed in a fine line. */
export const PlateStamp: React.FC<{ children: React.ReactNode; tone?: 'gold' | 'accent' }> = ({ children, tone = 'gold' }) => (
  <span className={`inline-flex items-center justify-center text-center rounded-full w-[72px] h-[72px] p-2 border border-double ring-1 ring-offset-2 ring-offset-[#fbf7ef] font-display italic text-[11px] leading-[1.15] text-stone-800 bg-[#fbf7ef] ${tone === 'gold' ? 'border-stone-400 ring-stone-300' : 'border-[rgb(var(--theme-accent-rgb))] ring-[rgb(var(--theme-accent-rgb)/0.35)]'}`}>
    {children}
  </span>
);

export default SpecimenPlate;
