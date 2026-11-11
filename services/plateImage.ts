/**
 * Render a specimen plate to a PNG so explorers can share the plate itself, not a bare link.
 * Pure canvas: no library, works offline, and falls back to a plate without the photo when the
 * image can't be read (for example a cross-origin URL without CORS headers).
 */
import { PlateData, plateFoot } from '../components/SpecimenPlate';
import { currentMarkUrl } from './brandMark';

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
  const words = text.split(/\s+/); const lines: string[] = []; let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
};

/** A recording drawn as a waveform on a dark mount, seeded by the name so each sound looks its own. */
function drawSound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: string) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#44403c'); g.addColorStop(1, '#1c1917');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const offset = Array.from(seed || 'sound').reduce((n, c) => n + c.charCodeAt(0), 0) % 7;
  const bars = 28, gap = 14, bw = 10;
  const total = bars * bw + (bars - 1) * gap;
  let bx = x + (w - total) / 2;
  const mid = y + h / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  for (let i = 0; i < bars; i++) {
    const amp = 0.18 + 0.72 * Math.abs(Math.sin((i + offset) * 0.62) * Math.cos((i + offset) * 0.21));
    const bh = Math.max(bw, amp * h * 0.5);
    const r = bw / 2;
    ctx.beginPath();
    ctx.moveTo(bx + r, mid - bh / 2);
    ctx.arc(bx + r, mid - bh / 2 + r, r, Math.PI, 0);
    ctx.lineTo(bx + bw, mid + bh / 2 - r);
    ctx.arc(bx + r, mid + bh / 2 - r, r, 0, Math.PI);
    ctx.closePath(); ctx.fill();
    bx += bw + gap;
  }
}

export async function renderPlate(d: PlateData & { line?: string; accent?: string }): Promise<Blob | null> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  try { await (document as any).fonts?.ready; } catch { /* ignore */ }
  // The landing's hand: cream paper, stone ink, Newsreader for names, Inter for the small print,
  // and the fortnight's colour only as one fine rule.
  const ink = '#1c1917', muted = '#78716c', accent = d.accent || '#57534e';

  ctx.fillStyle = '#fcfaf8'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#e7e5e4'; ctx.lineWidth = 2; ctx.strokeRect(56, 56, W - 112, H - 112);

  ctx.textBaseline = 'top';
  // NatureGram's mark (the landing's sun) and the wordmark, top left; the plate number top right
  const mx = 128, my = 120;
  // The same disc as the browser tab and home-screen icon (the fortnight's colours, or the admin's)
  try {
    const mark = await loadImage(currentMarkUrl());
    ctx.save(); ctx.beginPath(); ctx.arc(mx, my, 24, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(mark, mx - 24, my - 24, 48, 48); ctx.restore();
  } catch {
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, r1 = 15, r2 = 21;
      ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1); ctx.lineTo(mx + Math.cos(a) * r2, my + Math.sin(a) * r2); ctx.stroke();
    }
  }
  ctx.fillStyle = ink;
  ctx.font = 'italic 400 38px Newsreader, Georgia, serif';
  ctx.fillText('NatureGram', mx + 36, my - 22);
  if (d.no) { ctx.fillStyle = muted; const no = `No. ${d.no}`; ctx.fillText(no, W - 110 - ctx.measureText(no).width, my - 22); }

  const ix = 110, iy = 184, iw = W - 220, ih = 680;
  ctx.fillStyle = '#f3efe7'; ctx.fillRect(ix, iy, iw, ih);
  let drawn = false;
  if (d.thumb) {
    try {
      const img = await loadImage(d.thumb);
      const s = Math.max(iw / img.width, ih / img.height);
      const sw = iw / s, sh = ih / s;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, ix, iy, iw, ih);
      drawn = true;
    } catch { /* plate without the photo */ }
  }
  // A sound has no photograph: draw it as one, the waveform the feed's sound tiles use
  if (!drawn && d.sound) drawSound(ctx, ix, iy, iw, ih, d.name);

  let y = iy + ih + 56;
  ctx.fillStyle = ink; ctx.font = 'italic 400 76px Newsreader, Georgia, serif';
  for (const l of wrap(ctx, d.name, iw).slice(0, 2)) { ctx.fillText(l, ix, y); y += 86; }
  if (d.scientific) { ctx.fillStyle = muted; ctx.font = 'italic 38px Newsreader, Georgia, serif'; ctx.fillText(d.scientific, ix, y); y += 56; }
  const foot = plateFoot(d);
  if (foot) { ctx.fillStyle = muted; ctx.font = '28px Inter, system-ui, sans-serif'; ctx.fillText(foot, ix, y + 6); y += 56; }
  if (d.line) {
    const ly = Math.min(y + 14, H - 160);
    ctx.fillStyle = accent; ctx.fillRect(ix, ly + 18, 64, 2);
    ctx.fillStyle = '#44403c'; ctx.font = 'italic 32px Newsreader, Georgia, serif';
    let yy = ly;
    for (const l of wrap(ctx, d.line, iw - 88).slice(0, 2)) { ctx.fillText(l, ix + 88, yy); yy += 42; }
  }
  return await new Promise(res => c.toBlob(b => res(b), 'image/png'));
}

/** A file name for a plate: the species, lower case, hyphenated. */
export const plateFileName = (name: string) => `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'plate'}.png`;

/**
 * Share a plate image already rendered (the preview the explorer is looking at). Nothing is awaited
 * before navigator.share, so iOS still counts the tap as the gesture that allows sharing.
 */
export async function sharePlateBlob(blob: Blob, name: string, opts: { text?: string; url?: string } = {}): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  const file = new File([blob], plateFileName(name), { type: 'image/png' });
  const nav: any = navigator;
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name, text: [opts.text, opts.url].filter(Boolean).join('\n') }); return 'shared'; }
    catch (e: any) { return e?.name === 'AbortError' ? 'cancelled' : 'failed'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

/** Share a plate image through the OS share sheet; falls back to downloading the PNG. */
export async function sharePlate(d: PlateData & { line?: string; accent?: string }, opts: { text?: string; url?: string } = {}): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  const blob = await renderPlate(d).catch(() => null);
  if (!blob) return 'failed';
  return sharePlateBlob(blob, d.name, opts);
}
