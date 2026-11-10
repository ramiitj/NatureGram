import React from 'react';
import Glyph from './Glyph';
import { GROUP_GLYPH, LifeEntry, fieldDate } from '../services/lifeList';

/**
 * A specimen plate: one species presented the way a herbarium sheet or a field-guide plate would be.
 * Cream card, fine double rule, the photograph mounted in the middle, the common name in serif italic,
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
}

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
  const nameCls = size === 'sm' ? 'text-[13px]' : size === 'lg' ? 'text-2xl' : 'text-[15px]';
  return (
    <Tag
      onClick={onClick}
      aria-label={onClick ? `${data.name}${data.no ? `, number ${data.no} on the list` : ''}` : undefined}
      className={`relative text-left w-full rounded-[3px] ${pad} ${ghost ? 'bg-transparent border border-dashed border-stone-300' : 'bg-[#fbf7ef] shadow-[0_1px_2px_rgba(60,40,20,0.12),0_6px_18px_-8px_rgba(60,40,20,0.25)]'} ${onClick ? 'active:scale-[0.98] transition-transform' : ''} ${className}`}
    >
      <div className={`h-full rounded-[2px] ${ghost ? '' : 'border border-[#d8ccb6] outline outline-1 outline-offset-[3px] outline-[#e8dfcd]'} flex flex-col`}>
        <div className="flex items-center justify-between px-2 pt-1.5 font-display italic text-[12px] text-[#8a7a60]">
          <span>{data.no ? `No. ${data.no}` : ' '}</span>
          {data.group && <Glyph name={GROUP_GLYPH[data.group]} size={13} />}
        </div>
        <div className={`mx-2 mt-1 aspect-[4/3] overflow-hidden ${ghost ? 'bg-stone-100/60' : 'bg-[#efe7d6]'} flex items-center justify-center`}>
          {data.thumb && !ghost
            ? <img src={data.thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover sepia-[.08]" />
            : <Glyph name={data.group ? GROUP_GLYPH[data.group] : 'seedling'} size={size === 'lg' ? 48 : 28} className="text-[#b9a98a]" />}
        </div>
        <div className="px-2 pt-2 pb-2 flex-1 flex flex-col">
          <p className={`font-display italic leading-tight ${nameCls} ${ghost ? 'text-stone-400' : 'text-[#2f2a22]'} line-clamp-2`}>{data.name}</p>
          {data.scientific && size !== 'sm' && <p className="font-display italic text-[11px] text-[#8a7a60] truncate">{data.scientific}</p>}
          {!ghost && plateFoot(data) && <p className="mt-auto pt-1.5 text-[10px] leading-snug text-[#8a7a60]">{plateFoot(data)}</p>}
        </div>
      </div>
      {stamp && <div className="absolute -top-2 -right-2 rotate-[8deg]">{stamp}</div>}
    </Tag>
  );
};

/** A soft gold round stamp ("First for your list", "25th species", "Answers Darwin's challenge"). */
export const PlateStamp: React.FC<{ children: React.ReactNode; tone?: 'gold' | 'accent' }> = ({ children, tone = 'gold' }) => (
  <span className={`inline-flex items-center justify-center text-center rounded-full w-[68px] h-[68px] p-2 border-2 border-double text-[9px] leading-tight font-bold uppercase tracking-[0.08em] ${tone === 'gold' ? 'border-[#b8892b] text-[#8a6418] bg-[#fdf4dc]/95' : 'border-[rgb(var(--theme-accent-rgb))] text-[rgb(var(--theme-accent-rgb))] bg-white/95'}`}>
    {children}
  </span>
);

export default SpecimenPlate;
