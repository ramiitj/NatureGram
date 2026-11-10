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
  const ink = '#2f2a22', muted = '#8a7a60', accent = d.accent || '#8a6418';

  ctx.fillStyle = '#fbf7ef'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#d8ccb6'; ctx.lineWidth = 3; ctx.strokeRect(48, 48, W - 96, H - 96);
  ctx.strokeStyle = '#e8dfcd'; ctx.lineWidth = 2; ctx.strokeRect(64, 64, W - 128, H - 128);

  ctx.fillStyle = muted; ctx.font = '600 26px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  if (d.no) ctx.fillText(`NO. ${d.no}`, 110, 104);
  const brand = 'NATUREGRAM'; ctx.fillText(brand, W - 110 - ctx.measureText(brand).width, 104);

  const ix = 110, iy = 160, iw = W - 220, ih = 680;
  ctx.fillStyle = '#efe7d6'; ctx.fillRect(ix, iy, iw, ih);
  if (d.thumb) {
    try {
      const img = await loadImage(d.thumb);
      const s = Math.max(iw / img.width, ih / img.height);
      const sw = iw / s, sh = ih / s;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, ix, iy, iw, ih);
    } catch { /* plate without the photo */ }
  }

  let y = iy + ih + 60;
  ctx.fillStyle = ink; ctx.font = 'italic 500 76px Newsreader, Georgia, serif';
  for (const l of wrap(ctx, d.name, iw).slice(0, 2)) { ctx.fillText(l, ix, y); y += 86; }
  if (d.scientific) { ctx.fillStyle = muted; ctx.font = 'italic 38px Newsreader, Georgia, serif'; ctx.fillText(d.scientific, ix, y); y += 56; }
  const foot = plateFoot(d);
  if (foot) { ctx.fillStyle = muted; ctx.font = '30px Inter, system-ui, sans-serif'; ctx.fillText(foot, ix, y + 6); y += 56; }
  if (d.line) {
    ctx.fillStyle = accent; ctx.font = 'italic 32px Newsreader, Georgia, serif';
    for (const l of wrap(ctx, d.line, iw).slice(0, 2)) { ctx.fillText(l, ix, Math.min(y + 10, H - 150)); y += 42; }
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
