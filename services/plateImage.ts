/**
 * Render a specimen plate to a PNG so explorers can share the plate itself, not a bare link.
 * Pure canvas: no library, works offline, and falls back to a plate without the photo when the
 * image can't be read (for example a cross-origin URL without CORS headers).
 */
import { PlateData, plateFoot } from '../components/SpecimenPlate';

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
  ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.fill();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, r1 = 15, r2 = 21;
    ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1); ctx.lineTo(mx + Math.cos(a) * r2, my + Math.sin(a) * r2); ctx.stroke();
  }
  ctx.font = 'italic 400 38px Newsreader, Georgia, serif';
  ctx.fillText('NatureGram', mx + 36, my - 22);
  if (d.no) { ctx.fillStyle = muted; const no = `No. ${d.no}`; ctx.fillText(no, W - 110 - ctx.measureText(no).width, my - 22); }

  const ix = 110, iy = 184, iw = W - 220, ih = 680;
  ctx.fillStyle = '#f3efe7'; ctx.fillRect(ix, iy, iw, ih);
  if (d.thumb) {
    try {
      const img = await loadImage(d.thumb);
      const s = Math.max(iw / img.width, ih / img.height);
      const sw = iw / s, sh = ih / s;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, ix, iy, iw, ih);
    } catch { /* plate without the photo */ }
  }

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

/** Share a plate image through the OS share sheet; falls back to downloading the PNG. */
export async function sharePlate(d: PlateData & { line?: string; accent?: string }, opts: { text?: string; url?: string } = {}): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  const blob = await renderPlate(d).catch(() => null);
  if (!blob) return 'failed';
  const file = new File([blob], `${d.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'plate'}.png`, { type: 'image/png' });
  const nav: any = navigator;
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: d.name, text: [opts.text, opts.url].filter(Boolean).join('\n') }); return 'shared'; }
    catch (e: any) { return e?.name === 'AbortError' ? 'cancelled' : 'failed'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
