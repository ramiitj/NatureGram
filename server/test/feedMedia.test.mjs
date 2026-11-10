// Run: node --test server/test/feedMedia.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLqip, cleanTint, cleanDim, previewFields, feedFirstPost, firstTilesJson, injectFirstTiles, FIRST_TILES_BUDGET } from '../media.js';
import { thumbnailOf, mediaPathsOf as publishMediaPaths } from '../publish.js';
import * as fn from '../../functions/mediaProbe.js';

const WEBP = 'data:image/webp;base64,UklGRkQAAABXRUJQVlA4IDgAAADQAQCdASoQABQAPpFAmkmlo6IhKAgAsBIJZQAAPaOgAP7q1gAA';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAQABABAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKp//9k=';
const url = (path) => `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=t`;

test('lqip: only small JPEG or WebP data URLs pass, on the server and in the function alike', () => {
  const cases = [
    [WEBP, true], [JPEG, true],
    ['data:image/png;base64,iVBORw0KGgo=', false],
    ['data:image/svg+xml;base64,PHN2Zz4=', false],
    ['javascript:alert(1)', false],
    ['https://example.com/x.jpg', false],
    ['data:image/webp;base64,AAA"onerror="x', false],
    ['data:image/webp;base64,' + 'A'.repeat(977), true], // exactly 1000 characters
    ['data:image/webp;base64,' + 'A'.repeat(978), false],
    [null, false], [42, false], [{}, false],
  ];
  for (const [v, ok] of cases) {
    assert.equal(cleanLqip(v) !== null, ok, String(v).slice(0, 40));
    assert.equal(fn.cleanLqip(v) !== null, ok, `function: ${String(v).slice(0, 40)}`);
  }
});

test('preview fields: checked tint and size, aspect worked out, sound only for clips only', () => {
  assert.deepEqual(previewFields({ lqip: WEBP, tint: '#A1B2C3', w: 1080, h: 1920 }, 'image'), { lqip: WEBP, tint: '#a1b2c3', w: 1080, h: 1920, aspect: 0.5625 });
  assert.deepEqual(previewFields({ tint: 'red', w: 0, h: 10, lqip: 'nope' }, 'image'), {});
  assert.deepEqual(previewFields({ w: 1.5, h: 2 }, 'image'), {});
  assert.deepEqual(previewFields({ w: 30000, h: 2 }, 'image'), {});
  assert.deepEqual(previewFields({ soundOnly: true }, 'video'), { soundOnly: true });
  assert.deepEqual(previewFields({ soundOnly: true }, 'image'), {});
  assert.deepEqual(previewFields({ soundOnly: 'yes' }, 'video'), {});
  assert.deepEqual(previewFields(null), {});
  assert.equal(cleanTint('#abcdef'), '#abcdef');
  assert.equal(cleanDim(-1), null);
});

test('feed/first payload: the tile fields are always there, and bad values are dropped', () => {
  const p = feedFirstPost('p1', {
    mediaType: 'video', thumbnailUrl: 'https://x/t.jpg', thumbSmallUrl: 'https://x/s.jpg', videoUrl: 'https://x/v.webm', posterUrl: 'https://x/p.jpg',
    lqip: WEBP, tint: '#112233', w: 720, h: 1280, soundOnly: false, labels: ['Red fox', 'Vulpes vulpes'], userId: 'u1', userName: 'Ana',
    timestamp: { toMillis: () => 1700000000000 }, likes: ['a'], likeCount: 2, searchTokens: ['red'], items: [{}],
  });
  for (const k of ['id', 'mediaType', 'thumbnailUrl', 'thumbSmallUrl', 'videoUrl', 'posterUrl', 'lqip', 'tint', 'w', 'h', 'soundOnly', 'labels', 'userId', 'userName', 'likes', 'likeCount', 'ts']) assert.ok(k in p, k);
  assert.equal(p.ts, 1700000000000);
  assert.equal(p.posterUrl, 'https://x/p.jpg');
  assert.ok(!('searchTokens' in p) && !('items' in p), 'trimmed');
  const bad = feedFirstPost('p2', { lqip: 'data:image/svg+xml;base64,AAAA', tint: 'blue', w: '720', h: null, soundOnly: 'true' });
  assert.equal(bad.lqip, null); assert.equal(bad.tint, null); assert.equal(bad.w, null); assert.equal(bad.soundOnly, false);
  assert.equal(bad.mediaType, 'image'); assert.equal(bad.posterUrl, null); assert.equal(bad.ts, 0);
});

test('first tiles: at most six, within the page budget, safe inside a script tag', () => {
  const long = 'https://firebasestorage.googleapis.com/v0/b/demo/o/snapshots%2Fu%2F' + 'x'.repeat(180) + '.webp?alt=media&token=' + 'f'.repeat(36);
  const posts = Array.from({ length: 12 }, (_, i) => feedFirstPost(`p${i}`, {
    thumbnailUrl: long + 'b', thumbSmallUrl: long + 's', lqip: 'data:image/webp;base64,' + 'A'.repeat(500), tint: '#334455', w: 800, h: 1000,
    labels: ['</script><script>alert(1)</script>', 'Vulpes vulpes'], userId: 'u', userName: 'Ana', timestamp: { toMillis: () => i },
  }));
  const json = firstTilesJson(posts);
  assert.ok(json.length <= FIRST_TILES_BUDGET, `size ${json.length}`);
  assert.ok(!json.includes('</script>') && !json.includes('<'), 'escaped');
  const data = JSON.parse(json);
  assert.ok(data.posts.length >= 4 && data.posts.length <= 6, `tiles ${data.posts.length}`);
  assert.equal(data.posts[0].labels[0], '</script><script>alert(1)</script>');
  for (const t of data.posts) assert.ok(t.thumbSmallUrl && t.tint && t.w && t.h, 'every tile keeps a picture link, colour and size');
  assert.equal(firstTilesJson([]), null);
  assert.equal(JSON.parse(firstTilesJson(posts.slice(0, 3))).posts.length, 3);
});

test('first tiles go into the page just before </body>, and nothing else changes', () => {
  const html = '<html><head><title>x</title></head><body><div id="root"></div><script type="module" src="/index.tsx"></script></body></html>';
  const json = firstTilesJson([feedFirstPost('a', { thumbnailUrl: 'https://x/b.jpg', thumbSmallUrl: 'https://x/s.jpg' })]);
  const out = injectFirstTiles(html, json);
  assert.match(out, /<script type="module" src="\/index.tsx"><\/script>\s*<script type="application\/json" id="ng-first">\{.*\}<\/script>\s*<\/body><\/html>$/s);
  assert.ok(out.startsWith('<html><head><title>x</title></head><body><div id="root"></div>'));
  assert.equal(injectFirstTiles(html, null), html);
  assert.ok(!out.includes('rel="preload"'));
});

test('feed entries carry the preview fields the post has, and only valid ones', () => {
  const t = thumbnailOf('p', { userId: 'u', mediaType: 'video', lqip: WEBP, tint: '#010203', w: 9, h: 16, soundOnly: true, posterUrl: 'https://x/p.jpg' });
  assert.equal(t.lqip, WEBP); assert.equal(t.tint, '#010203'); assert.equal(t.aspect, 0.5625); assert.equal(t.soundOnly, true); assert.equal(t.posterUrl, 'https://x/p.jpg');
  const old = thumbnailOf('q', { userId: 'u', lqip: 'bad' });
  assert.ok(!('lqip' in old) && !('w' in old) && !('posterUrl' in old), 'older posts stay as they were');
});

test('media paths: clips and recordings of the post and its items, same on server and function', () => {
  const post = { videoUrl: url('videos/u1/a.webm'), items: [{ videoUrl: url('videos/u1/a.webm') }, { audioUrl: url('audio/u1/b.webm') }, { imageUrl: url('snapshots/u1/c.jpg') }, { videoUrl: 'https://evil.example/v.mp4' }] };
  assert.deepEqual(publishMediaPaths(post), ['videos/u1/a.webm', 'audio/u1/b.webm']);
  assert.deepEqual(fn.mediaPathsOf(post), ['videos/u1/a.webm', 'audio/u1/b.webm']);
  assert.deepEqual(publishMediaPaths({}), []);
});

test('ffmpeg stream list: picture or not, size with rotation, cover art is not a picture', () => {
  const clip = `Input #0, matroska,webm, from 'a.webm':\n  Duration: 00:00:02.01, start: 0.000000, bitrate: 170 kb/s\n  Stream #0:0: Video: vp8, yuv420p(progressive), 640x480, SAR 1:1 DAR 4:3, 10 fps\n  Stream #0:1: Audio: opus, 48000 Hz, mono, fltp`;
  assert.deepEqual(fn.parseProbe(clip), { hasVideo: true, hasAudio: true, w: 640, h: 480, duration: 2.01 });
  const sound = `  Duration: 00:00:05.00, start: 0.000000\n  Stream #0:0: Audio: opus, 48000 Hz, mono, fltp`;
  assert.equal(fn.parseProbe(sound).hasVideo, false);
  const phone = `  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps\n    Side data:\n      displaymatrix: rotation of -90.00 degrees`;
  assert.deepEqual([fn.parseProbe(phone).w, fn.parseProbe(phone).h], [1080, 1920]);
  const m4a = `  Stream #0:0: Audio: aac (LC), 44100 Hz, stereo\n  Stream #0:1: Video: mjpeg (Baseline), yuvj420p, 600x600, 90k tbr (attached pic)`;
  assert.equal(fn.parseProbe(m4a).hasVideo, false);
});

test('poster write-back fills only empty fields, never overwrites, and finds the right items', () => {
  const path = 'videos/u1/a.webm';
  const media = { posterUrl: 'https://x/p.jpg', posterSmallUrl: 'https://x/ps.jpg', w: 720, h: 1280, lqip: WEBP, tint: '#445566', soundOnly: false };
  const post = {
    videoUrl: url(path), thumbnailUrl: 'https://x/own.jpg', thumbSmallUrl: '', lqip: null,
    items: [{ videoUrl: url(path), thumbnailUrl: '' }, { imageUrl: url('snapshots/u1/c.jpg'), thumbnailUrl: 'https://x/c.jpg' }],
  };
  const plan = fn.planPostFill(post, path, media);
  assert.equal(plan.post.thumbnailUrl, undefined, 'explorer\'s own still kept');
  assert.equal(plan.post.thumbSmallUrl, 'https://x/ps.jpg');
  assert.equal(plan.post.posterUrl, 'https://x/p.jpg');
  assert.deepEqual([plan.post.w, plan.post.h, plan.post.aspect, plan.post.lqip, plan.post.tint], [720, 1280, 0.5625, WEBP, '#445566']);
  assert.equal(plan.post.items[0].thumbnailUrl, 'https://x/p.jpg');
  assert.deepEqual(plan.post.items[1], post.items[1], 'other items untouched');
  assert.deepEqual(plan.post.mediaPaths, [path]);
  assert.ok(plan.top && !('items' in plan.top));
  // Already complete: nothing to write
  const done = { ...post, ...plan.post, items: plan.post.items };
  assert.equal(fn.planPostFill(done, path, media), null);
  // Size is a pair: one half present means leave both
  assert.ok(!('w' in fn.fillEmpty({ w: 10 }, media)));
  // A clip of some other post's path changes nothing but the paths list
  assert.deepEqual(fn.planPostFill({ videoUrl: url('videos/u1/z.webm') }, path, media), { post: { mediaPaths: ['videos/u1/z.webm'] }, top: null });
  // Sound only: marked, no still
  assert.deepEqual(fn.fillEmpty({}, { soundOnly: true, posterUrl: 'x' }), { soundOnly: true });
});

test('poster backfill knows which posts still need it', () => {
  assert.equal(fn.needsPoster({ mediaType: 'video', videoUrl: url('videos/u/a.webm') }), true);
  assert.equal(fn.needsPoster({ mediaType: 'video', videoUrl: url('videos/u/a.webm'), thumbnailUrl: 'x', lqip: WEBP, w: 1, h: 1, streamUrl: 'https://s', mediaPaths: ['videos/u/a.webm'] }), false);
  // A poster alone is not enough any more: the clip also needs its quick-start streaming copy
  assert.equal(fn.needsPoster({ mediaType: 'video', videoUrl: url('videos/u/a.webm'), thumbnailUrl: 'x', lqip: WEBP, w: 1, h: 1, mediaPaths: ['videos/u/a.webm'] }), true);
  assert.equal(fn.needsPoster({ mediaType: 'video', soundOnly: true, mediaPaths: [] }), false);
  assert.equal(fn.needsPoster({ mediaType: 'image', thumbnailUrl: 'x' }), true);
  assert.equal(fn.needsPoster({ mediaType: 'image', thumbnailUrl: 'x', lqip: WEBP, w: 1, h: 1 }), false);
  assert.equal(fn.needsPoster({ mediaType: 'audio' }), false);
});
