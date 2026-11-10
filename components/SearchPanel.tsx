import React, { useEffect, useMemo, useState } from 'react';
import Glyph from './Glyph';
import SpecimenPlate, { PlateData } from './SpecimenPlate';
import { FirebaseService } from '../services/firebaseService';
import { groupOf, seasonOf, toMs, namesOf, reconciledStats, GROUP_GLYPH, LifeGroup } from '../services/lifeList';
import { track } from '../services/analytics';
import { CommunityPost, UserProfileData } from '../types';

/**
 * One search for the whole app. The feed's search field and Explore both use this: the same field,
 * the same words in it, the same server search (FirebaseService.searchPosts and searchUsers), and
 * the same results, grouped as species, sightings, places and tags, and explorers.
 */
export const SEARCH_PLACEHOLDER = 'Search species, places, people';

const IGNORE = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)/i;
const SYSTEM_TAGS = new Set(['fieldguide', 'naturegram', 'nature', 'wildlife']);

/** A sighting as a specimen plate (Explore's shelves and the search results). */
export const plateOfPost = (p: CommunityPost): PlateData => {
  const ms = toMs((p as any).observedAt) || toMs(p.timestamp);
  const names = namesOf(p);
  return {
    name: names.common || 'Unnamed sighting',
    scientific: names.latin,
    thumb: (p as any).thumbSmallUrl || p.thumbnailUrl || (p as any).imageUrl,
    firstMs: ms || undefined,
    place: p.showLocation !== false && p.locationArea ? p.locationArea : undefined,
    season: ms ? seasonOf(ms) : undefined,
    group: groupOf(p),
  };
};

/** The first part of a sighting's place ("Lodhi Garden, Delhi" → "Lodhi Garden"), if it may be shown. */
export const placeOf = (p: CommunityPost) => p.showLocation === false ? '' : String(p.locationArea || '').split(',')[0].trim();

/** "12 species · 40 sightings", only once the server has reconciled the counts. */
export const explorerStatsLine = (u: any): string => {
  const st = reconciledStats(u);
  if (!st) return '';
  return `${st.species} species · ${st.sightings} ${st.sightings === 1 ? 'sighting' : 'sightings'}`;
};

interface SearchPanelProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** Show the grouped results below the field */
  open: boolean;
  onFocus?: () => void;
  /** When given, a Cancel button sits beside the field while results are open */
  onCancel?: () => void;
  /** Something to place beside the field (the feed's Filters button) */
  aside?: React.ReactNode;
  onOpenPost: (post: CommunityPost) => void;
  onOpenProfile: (uid: string) => void;
  /** Open a species' field-guide page; without it, choosing a species searches for it */
  onOpenSpecies?: (name: string) => void;
  /** Words to offer before anything is typed */
  suggestions?: string[];
  inputId?: string;
  autoFocus?: boolean;
}

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="ng-subtitle mb-3">{children}</h3>
);

const SearchPanel: React.FC<SearchPanelProps> = ({
  query, onQueryChange, open, onFocus, onCancel, aside, onOpenPost, onOpenProfile, onOpenSpecies, suggestions = [], inputId = 'ng-search', autoFocus,
}) => {
  const term = query.trim();
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [users, setUsers] = useState<UserProfileData[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (term.length < 2) { setPosts(null); setUsers([]); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = window.setTimeout(() => {
      track('search', { length: term.length });
      const people = term.startsWith('#') ? Promise.resolve([] as UserProfileData[]) : FirebaseService.searchUsers(term).catch(() => [] as UserProfileData[]);
      Promise.all([FirebaseService.searchPosts(term, 40).catch(() => [] as CommunityPost[]), people]).then(([p, u]) => {
        if (!alive) return;
        setPosts(p); setUsers(u); setSearching(false);
      });
    }, 300);
    return () => { alive = false; window.clearTimeout(t); };
  }, [term]);

  const words = useMemo(() => term.toLowerCase().replace(/^[#@]/, '').split(/\s+/).filter(Boolean), [term]);

  const species = useMemo(() => {
    const m = new Map<string, { name: string; latin?: string; count: number; group: LifeGroup }>();
    (posts || []).forEach(p => {
      const label = String(p.labels?.[0] || '').trim();
      if (!label || IGNORE.test(label)) return;
      const key = label.toLowerCase();
      const e = m.get(key);
      if (e) { e.count++; return; }
      const n = namesOf(p);
      m.set(key, { name: n.common || label, latin: n.latin, count: 1, group: groupOf(p) });
    });
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [posts]);

  const placesAndTags = useMemo(() => {
    const places = new Map<string, number>();
    const tags = new Map<string, number>();
    (posts || []).forEach(p => {
      const pl = placeOf(p);
      if (pl) places.set(pl, (places.get(pl) || 0) + 1);
      (p.tags || []).forEach(t => {
        const k = String(t || '').replace(/^#/, '').toLowerCase();
        if (!k || SYSTEM_TAGS.has(k) || !words.some(w => k.includes(w))) return;
        tags.set(k, (tags.get(k) || 0) + 1);
      });
    });
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
    return { places: top(places, 6), tags: top(tags, 6) };
  }, [posts, words]);

  const nothing = posts !== null && !searching && posts.length === 0 && users.length === 0;
  const summary = posts === null ? '' : `${posts.length} ${posts.length === 1 ? 'sighting' : 'sightings'}${users.length ? ` and ${users.length} ${users.length === 1 ? 'explorer' : 'explorers'}` : ''}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <label htmlFor={inputId} className="sr-only">{SEARCH_PLACEHOLDER}</label>
          <Glyph name="search" size={20} className="absolute left-0 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
          <input
            id={inputId}
            type="search"
            value={query}
            autoFocus={autoFocus}
            onFocus={onFocus}
            onChange={e => onQueryChange(e.target.value.slice(0, 80))}
            onKeyDown={e => { if (e.key === 'Escape' && onCancel) onCancel(); }}
            placeholder={SEARCH_PLACEHOLDER}
            enterKeyHint="search"
            autoComplete="off"
            className={`ng-field-line pl-8 ${query ? 'pr-10' : 'pr-0'} [&::-webkit-search-cancel-button]:hidden`}
          />
          {query && (
            <button type="button" onClick={() => onQueryChange('')} aria-label="Clear search" className="absolute -right-2 top-1/2 -translate-y-1/2 ng-icon-button text-stone-500">
              <Glyph name="close" size={20} />
            </button>
          )}
        </div>
        {open && onCancel
          ? <button type="button" onClick={onCancel} className="ng-link-quiet min-h-[44px] shrink-0">Cancel</button>
          : aside}
      </div>

      {open && (
        <div className="flex flex-col gap-8 pt-2" aria-live="polite" aria-busy={searching}>
          {term.length < 2 ? (
            suggestions.length > 0 && (
              <section aria-label="Suggestions">
                <p className="ng-small mb-3">Try a species, a place, a #tag or an explorer's name.</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.slice(0, 8).map(s => (
                    <button key={s} type="button" onClick={() => onQueryChange(s)} className="ng-chip">{s}</button>
                  ))}
                </div>
              </section>
            )
          ) : searching && posts === null ? (
            <p className="ng-small">Looking…</p>
          ) : nothing ? (
            <p className="ng-small">Nothing matches “{term}” yet. Try another word.</p>
          ) : (
            <>
              <p className="sr-only">{summary}</p>
              {species.length > 0 && (
                <section aria-label="Species">
                  <Heading>Species</Heading>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8" role="list">
                    {species.map(s => (
                      <li key={s.name} className="min-w-0 border-b border-stone-200/70">
                        <button type="button" onClick={() => onOpenSpecies ? onOpenSpecies(s.name) : onQueryChange(s.name)} className="w-full flex items-center gap-4 py-3 text-left transition-colors hover:text-stone-900">
                          <Glyph name={GROUP_GLYPH[s.group]} size={20} className="text-stone-400 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-display italic text-base text-stone-900 truncate">{s.name}</span>
                            {s.latin && <span className="block font-display italic text-xs text-stone-500 truncate">{s.latin}</span>}
                          </span>
                          <span className="text-xs text-stone-500 tabular-nums shrink-0">{s.count} {s.count === 1 ? 'sighting' : 'sightings'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {posts && posts.length > 0 && (
                <section aria-label="Sightings">
                  <Heading>Sightings</Heading>
                  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" role="list">
                    {posts.slice(0, 12).map(p => (
                      <li key={p.id}><SpecimenPlate data={plateOfPost(p)} size="sm" onClick={() => onOpenPost(p)} /></li>
                    ))}
                  </ul>
                </section>
              )}
              {(placesAndTags.places.length > 0 || placesAndTags.tags.length > 0) && (
                <section aria-label="Places and tags">
                  <Heading>Places and tags</Heading>
                  <div className="flex flex-wrap gap-2">
                    {placesAndTags.places.map(pl => (
                      <button key={`p-${pl}`} type="button" onClick={() => onQueryChange(pl)} className="ng-chip">
                        <Glyph name="pin" size={16} className="text-stone-400" />{pl}
                      </button>
                    ))}
                    {placesAndTags.tags.map(tg => (
                      <button key={`t-${tg}`} type="button" onClick={() => onQueryChange(`#${tg}`)} className="ng-chip">
                        <Glyph name="tag" size={16} className="text-stone-400" />#{tg}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {users.length > 0 && (
                <section aria-label="Explorers">
                  <Heading>Explorers</Heading>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8" role="list">
                    {users.map(u => {
                      const line = explorerStatsLine(u) || (u.bio || '').slice(0, 80);
                      return (
                        <li key={u.uid} className="min-w-0 border-b border-stone-200/70">
                          <button type="button" onClick={() => onOpenProfile(u.uid)} className="w-full flex items-center gap-4 py-3 text-left">
                            {u.avatarUrl
                              ? <img src={u.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                              : <span className="w-10 h-10 rounded-full bg-[#f3efe7] flex items-center justify-center font-display text-lg text-stone-700 shrink-0" aria-hidden="true">{(u.username || '?').charAt(0).toUpperCase()}</span>}
                            <span className="min-w-0">
                              <span className="block font-medium text-stone-900 truncate">{u.username}</span>
                              {line && <span className="block text-xs text-stone-500 truncate">{line}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchPanel;
