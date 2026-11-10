/**
 * How quickly the feed shows the wild, and whether any tile is left without a picture.
 *  - feed_first_tile_ms: navigation start to the first tile painted with its blurred preview or its picture
 *  - feed_blank_tiles: tiles with no picture source at all (no image, still, preview or sound tile) 3 s after the feed first shows
 * Both once per page load. See docs/ANALYTICS.md.
 */
import { track } from './analytics';

let firstTileDone = false;
let firstSource: 'inline' | 'network' = 'network';

/** Where the first page came from: inlined in the page, or fetched. */
export const setFirstSource = (s: 'inline' | 'network') => { firstSource = s; };

export function markFirstTile(kind: 'image' | 'lqip') {
  if (firstTileDone || typeof performance === 'undefined') return;
  firstTileDone = true;
  const ms = Math.round(performance.now());
  try { (window as any).__ngFirstTile = { ms, kind, source: firstSource }; } catch { /* ignore */ }
  track('feed_first_tile_ms', { ms, kind, source: firstSource });
}

/** Tiles on screen and whether each has something to show. */
const tiles = new Map<string, boolean>();
export function registerTile(id: string, hasSource: boolean) { tiles.set(id, hasSource); }
export function unregisterTile(id: string) { tiles.delete(id); }

let blankScheduled = false;
export function scheduleBlankCount(delayMs = 3000) {
  if (blankScheduled || typeof window === 'undefined') return;
  blankScheduled = true;
  window.setTimeout(() => {
    const blank = [...tiles.values()].filter(v => !v).length;
    try { (window as any).__ngBlankTiles = { blank, tiles: tiles.size }; } catch { /* ignore */ }
    track('feed_blank_tiles', { count: blank, tiles: tiles.size });
  }, delayMs);
}
