import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import Glyph from './Glyph';
import SpecimenPlate from './SpecimenPlate';
import { NaturalistExtra } from '../constants/naturalistExtras';
import { groupOf, seasonOf, toMs } from '../services/lifeList';
import { periodAt, periodLabel, tagVariants } from '../services/stamps';

// Re-exported so the profile can import the stamp helper from either place.
export { challengeStamps } from '../services/stamps';
export type { ChallengeStamp } from '../services/stamps';

interface ThemeLike {
  id?: string;
  naturalist: string;
  quote?: string;
  imageUrl?: string;
  locationName?: string;
  locationCaption?: string;
}

interface Props {
  theme: ThemeLike;
  /** getNaturalistExtra(theme.id): bio, lifespan, philosophy, challenge */
  extra: NaturalistExtra;
  /** getThemePeriod(): days left and who comes next */
  period: { daysRemaining: number; next?: { naturalist: string } };
  onClose: () => void;
  onOpenPost?: (postId: string) => void;
  onOpenLens?: () => void;
}

interface Answer { id: string; name: string; thumb?: string; place?: string; ms: number; userName?: string; group: ReturnType<typeof groupOf>; season?: string }

const IGNORE = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)/i;

/** Public sightings carrying a challenge tag, newest first (same query shape as the feed's challenge card). */
export const fetchChallengeAnswers = async (tag: string, max = 24): Promise<any[]> => {
  const snap = await getDocs(query(collection(db, 'feed_thumbnails'), where('tags', 'array-contains-any', tagVariants(tag)), where('isPublic', '==', true), orderBy('timestamp', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
};

/**
 * The naturalist of the fortnight, told properly: who they were, how they saw the world,
 * what they ask of us these two weeks, and what the community has found in answer.
 * Opened from the landing quote and from the feed's challenge card.
 */
const NaturalistPage: React.FC<Props> = ({ theme, extra, period, onClose, onOpenPost, onOpenLens }) => {
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const span = useMemo(() => periodAt(), []);

  useEffect(() => {
    let alive = true;
    fetchChallengeAnswers(extra.challengeTag)
      .then(rows => {
        if (!alive) return;
        setAnswers(rows.map(p => {
          const ms = toMs(p.timestamp);
          const label = String(p.labels?.[0] || p.title || '').trim();
          return {
            id: p.id, name: label && !IGNORE.test(label) ? label : 'An answer',
            thumb: p.thumbSmallUrl || p.thumbnailUrl || undefined,
            place: p.showLocation !== false && p.locationArea ? p.locationArea : undefined,
            ms, userName: p.userName, group: groupOf(p), season: ms ? seasonOf(ms) : undefined,
          };
        }));
      })
      .catch(() => { if (alive) setAnswers([]); });
    return () => { alive = false; };
  }, [extra.challengeTag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const thisFortnight = (answers || []).filter(a => a.ms >= span.start.getTime());
  const earlier = (answers || []).filter(a => a.ms < span.start.getTime());

  return (
    <div className="fixed inset-0 z-[120] bg-day-bg overflow-y-auto overscroll-contain animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="naturalist-name">
      <div className="relative h-[42vh] min-h-[260px] max-h-[420px] bg-stone-900 overflow-hidden">
        {theme.imageUrl && <img src={theme.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />}
        <div className="absolute inset-0 bg-gradient-to-t from-day-bg via-day-bg/10 to-black/30" aria-hidden="true" />
        <button onClick={onClose} autoFocus aria-label="Close" className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] w-11 h-11 rounded-full bg-black/30 backdrop-blur text-white flex items-center justify-center">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
      </div>

      <article className="relative -mt-24 max-w-2xl mx-auto px-4 sm:px-6 pb-20">
        <header className="bg-[#fbf7ef] rounded-[3px] p-6 shadow-[0_1px_2px_rgba(60,40,20,0.12),0_10px_30px_-12px_rgba(60,40,20,0.3)]">
          <div className="border border-[#d8ccb6] outline outline-1 outline-offset-[3px] outline-[#e8dfcd] rounded-[2px] p-5">
            <p className="text-sm text-[#8a7a60]">Naturalist of the fortnight · {periodLabel(span)}</p>
            <h1 id="naturalist-name" className="font-display text-4xl font-semibold text-stone-900 mt-1 leading-tight">{theme.naturalist}</h1>
            {extra.lifespan && <p className="font-display italic text-lg text-[#8a7a60] mt-0.5">{extra.lifespan}</p>}
            {extra.bio && <p className="text-[15px] text-stone-800 leading-relaxed mt-4">{extra.bio}</p>}
            {theme.locationCaption && <p className="text-sm text-stone-600 mt-2">{theme.locationName ? `${theme.locationName}: ` : ''}{theme.locationCaption}</p>}
          </div>
        </header>

        {theme.quote && (
          <figure className="mt-10 px-2">
            <blockquote className="font-display italic text-2xl text-theme-primary leading-snug">“{theme.quote}”</blockquote>
          </figure>
        )}

        <section className="mt-10" aria-labelledby="way-of-seeing">
          <h2 id="way-of-seeing" className="font-display text-xl font-semibold text-stone-900">A way of seeing</h2>
          <p className="text-[17px] text-stone-800 leading-relaxed mt-2">{extra.philosophy}</p>
        </section>

        <section className="mt-8 rounded-2xl border border-theme-accent/30 bg-insight-bg p-5" aria-labelledby="fortnight-challenge">
          <div className="flex items-start gap-3">
            <Glyph name="stamp" size={30} className="text-theme-accent mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 id="fortnight-challenge" className="font-display text-xl font-semibold text-stone-900">This fortnight's challenge</h2>
              <p className="text-[16px] text-theme-primary leading-relaxed mt-1.5">{extra.challenge}</p>
              <p className="text-sm text-stone-600 mt-2">
                Tag your sighting {extra.challengeTag} · {periodLabel(span)} · {period.daysRemaining} day{period.daysRemaining === 1 ? '' : 's'} left
              </p>
              {onOpenLens && (
                <button onClick={onOpenLens} className="mt-4 px-5 py-2.5 rounded-full bg-theme-primary text-white text-sm font-semibold inline-flex items-center gap-2">
                  <Glyph name="lens" size={18} /> Go and look
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="answers-title">
          <h2 id="answers-title" className="font-display text-xl font-semibold text-stone-900">What explorers found</h2>
          <p className="text-sm text-stone-600 mt-1">A small exhibition of answers to {theme.naturalist.split(' ').slice(-1)[0]}'s challenge.</p>
          {answers === null ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5" aria-hidden="true">
              {[0, 1, 2].map(i => <SpecimenPlate key={i} ghost size="sm" data={{ name: ' ' }} />)}
            </div>
          ) : answers.length === 0 ? (
            <p className="mt-5 text-stone-600 font-display text-lg">No answers yet. The first one could be yours.</p>
          ) : (
            <>
              {thisFortnight.length > 0 && <Exhibit list={thisFortnight} onOpenPost={onOpenPost} />}
              {earlier.length > 0 && (
                <>
                  <h3 className="font-display text-lg text-stone-700 mt-8">From an earlier fortnight</h3>
                  <Exhibit list={earlier} onOpenPost={onOpenPost} />
                </>
              )}
            </>
          )}
        </section>

        {period.next?.naturalist && (
          <p className="mt-12 text-sm text-stone-500 text-center">In {period.daysRemaining} day{period.daysRemaining === 1 ? '' : 's'}, {theme.naturalist.split(' ').slice(-1)[0]} hands the notebook to {period.next.naturalist}.</p>
        )}
      </article>
    </div>
  );
};

const Exhibit: React.FC<{ list: Answer[]; onOpenPost?: (id: string) => void }> = ({ list, onOpenPost }) => (
  <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5" role="list">
    {list.map(a => (
      <li key={a.id}>
        <SpecimenPlate
          size="sm"
          data={{ name: a.name, thumb: a.thumb, firstMs: a.ms, place: a.place, season: a.season, group: a.group }}
          onClick={onOpenPost ? () => onOpenPost(a.id) : undefined}
        />
        {a.userName && <p className="text-xs text-stone-500 mt-1.5 truncate">— {a.userName}</p>}
      </li>
    ))}
  </ul>
);

export default NaturalistPage;
