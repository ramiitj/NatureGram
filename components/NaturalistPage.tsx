import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import Glyph from './Glyph';
import SpecimenPlate from './SpecimenPlate';
import { NaturalistExtra } from '../constants/naturalistExtras';
import { groupOf, seasonOf, toMs } from '../services/lifeList';
import { periodAt, periodLabel, tagVariants } from '../services/stamps';

interface WikiAbout {
  source: 'wikipedia';
  title: string;
  extract: string;
  url: string;
  textLicense: { name: string; url: string };
  portrait: { src: string; artist: string; license: string; licenseUrl?: string | null; filePage: string; width?: number; height?: number } | null;
}

// Re-exported so the profile can import the stamp helper from either place.
export { challengeStamps } from '../services/stamps';
export type { ChallengeStamp } from '../services/stamps';

interface ThemeLike {
  id?: string;
  naturalist: string;
  quote?: string;
  imageUrl?: string;
  imageCredit?: { author: string; license: string; source: string };
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
  // "From Wikipedia": fetched and licence-checked by our server (visitors never contact Wikipedia)
  const [wiki, setWiki] = useState<WikiAbout | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/naturalist/${encodeURIComponent(theme.id)}/about`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.source && d.extract) setWiki(d); })
      .catch(() => { /* the page keeps NatureGram's own words */ });
    return () => { alive = false; };
  }, [theme.id]);
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
      <div className="relative h-[52vh] min-h-[320px] max-h-[520px] bg-stone-950 overflow-hidden text-white">
        {theme.imageUrl && <img src={theme.imageUrl} alt="" className="ng-settle absolute inset-0 w-full h-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/35" aria-hidden="true" />
        <button onClick={onClose} autoFocus aria-label="Close" className="ng-icon-button-dark absolute left-4 md:left-10 top-[calc(env(safe-area-inset-top)+1rem)]">
          <Glyph name="back" size={24} />
        </button>
        <header className="absolute inset-x-0 bottom-0 max-w-2xl mx-auto px-6 pb-8 md:pb-10 ng-rise">
          <p className="flex items-center gap-3 text-sm text-white/80"><span className="block w-8 h-px bg-theme-vivid" aria-hidden="true" />Naturalist of the fortnight · {periodLabel(span)}</p>
          <h1 id="naturalist-name" className="font-display text-[40px] md:text-5xl leading-[1.08] mt-3 text-white text-balance">{theme.naturalist}</h1>
          {extra.lifespan && <p className="font-display italic text-lg text-white/75 mt-1">{extra.lifespan}</p>}
        </header>
      </div>

      <article className="relative max-w-2xl mx-auto px-6 pt-10 pb-24">
        <header>
          <div>
            {wiki ? (
              <section aria-labelledby="from-wikipedia" className="flex flex-col sm:flex-row gap-5 sm:gap-6">
                {wiki.portrait && (
                  <figure className="shrink-0 w-32 sm:w-36 self-start bg-[#fbf7ef] border border-[#e8dfcd] rounded-md p-2">
                    <div className="aspect-[3/4] overflow-hidden rounded-[3px] bg-[#f3efe7]">
                      <img src={wiki.portrait.src} alt={`Portrait of ${theme.naturalist}`} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    </div>
                    <figcaption className="sr-only">{`Portrait: ${wiki.portrait.artist}, ${wiki.portrait.license}`}</figcaption>
                  </figure>
                )}
                <div className="min-w-0">
                  <p id="from-wikipedia" className="ng-kicker">From Wikipedia</p>
                  <p className="ng-body text-stone-800 mt-2">{wiki.extract}</p>
                  <a href={wiki.url} target="_blank" rel="noopener noreferrer" className="ng-link mt-3 inline-flex items-center gap-1.5 min-h-[44px]">
                    Read more on Wikipedia <Glyph name="external" size={16} />
                  </a>
                  <p className="ng-caption mt-2">
                    Text from <a href={wiki.url} target="_blank" rel="noopener noreferrer" className="underline decoration-stone-300 underline-offset-2 hover:text-stone-700">Wikipedia</a>,{' '}
                    <a href={wiki.textLicense.url} target="_blank" rel="noopener noreferrer" className="underline decoration-stone-300 underline-offset-2 hover:text-stone-700">{wiki.textLicense.name}</a>
                    {wiki.portrait && (<>
                      {' · '}Portrait:{' '}
                      <a href={wiki.portrait.filePage} target="_blank" rel="noopener noreferrer" className="underline decoration-stone-300 underline-offset-2 hover:text-stone-700">{wiki.portrait.artist}</a>
                      , {wiki.portrait.license}, via Wikimedia Commons
                    </>)}
                  </p>
                </div>
              </section>
            ) : extra.bio && <p className="ng-body text-stone-800">{extra.bio}</p>}
            {theme.locationCaption && <p className="ng-small mt-3">{theme.locationName ? `${theme.locationName}: ` : ''}{theme.locationCaption}</p>}
            {theme.imageUrl && theme.imageCredit?.author && (
              <p className="ng-caption mt-3">
                Photograph:{' '}
                <a href={theme.imageCredit.source} target="_blank" rel="noopener noreferrer" className="underline decoration-stone-300 underline-offset-2 hover:text-stone-700">
                  {theme.imageCredit.author}
                </a>
                , {theme.imageCredit.license}, via Wikimedia Commons
              </p>
            )}
          </div>
        </header>

        {theme.quote && (
          <figure className="mt-14">
            <span className="ng-rule mb-5" aria-hidden="true" />
            <blockquote className="font-display italic text-[28px] md:text-[40px] text-stone-900 leading-[1.15] text-balance">“{theme.quote}”</blockquote>
          </figure>
        )}

        <section className="mt-14" aria-labelledby="way-of-seeing">
          <h2 id="way-of-seeing" className="ng-subtitle">A way of seeing</h2>
          <p className="ng-body text-stone-800 mt-3">{extra.philosophy}</p>
        </section>

        <section className="mt-14 py-8 border-y border-stone-200/80" aria-labelledby="fortnight-challenge">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 id="fortnight-challenge" className="ng-kicker">This fortnight's challenge</h2>
              <p className="font-display italic text-[20px] md:text-[28px] leading-[1.3] text-stone-900 mt-4 text-pretty">{extra.challenge}</p>
              <p className="ng-small mt-3">
                Tag your sighting {extra.challengeTag}
              </p>
              {onOpenLens && (
                <button onClick={onOpenLens} className="ng-button-primary group mt-6">
                  Go and look<Glyph name="forward" size={20} className="ng-arrow transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="mt-14" aria-labelledby="answers-title">
          <h2 id="answers-title" className="ng-subtitle">What explorers found</h2>
          <p className="ng-small mt-1">A small exhibition of answers to {theme.naturalist.split(' ').slice(-1)[0]}'s challenge.</p>
          {answers === null ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5" aria-hidden="true">
              {[0, 1, 2].map(i => <SpecimenPlate key={i} ghost size="sm" data={{ name: ' ' }} />)}
            </div>
          ) : answers.length === 0 ? (
            <p className="mt-6 text-stone-600 font-display italic text-lg">No answers yet. The first one could be yours.</p>
          ) : (
            <>
              {thisFortnight.length > 0 && <Exhibit list={thisFortnight} onOpenPost={onOpenPost} />}
              {earlier.length > 0 && (
                <>
                  <h3 className="ng-subtitle text-stone-700 mt-12">From an earlier fortnight</h3>
                  <Exhibit list={earlier} onOpenPost={onOpenPost} />
                </>
              )}
            </>
          )}
        </section>

        {period.next?.naturalist && (
          <p className="mt-16 font-display italic text-base text-stone-500 text-center">In {period.daysRemaining} day{period.daysRemaining === 1 ? '' : 's'}, {theme.naturalist.split(' ').slice(-1)[0]} hands the notebook to {period.next.naturalist}.</p>
        )}
      </article>
    </div>
  );
};

const Exhibit: React.FC<{ list: Answer[]; onOpenPost?: (id: string) => void }> = ({ list, onOpenPost }) => (
  <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4 md:gap-6 mt-6" role="list">
    {list.map(a => (
      <li key={a.id}>
        <SpecimenPlate
          size="sm"
          data={{ name: a.name, thumb: a.thumb, firstMs: a.ms, place: a.place, season: a.season, group: a.group }}
          onClick={onOpenPost ? () => onOpenPost(a.id) : undefined}
        />
        {a.userName && <p className="ng-caption mt-2 truncate">— {a.userName}</p>}
      </li>
    ))}
  </ul>
);

export default NaturalistPage;
