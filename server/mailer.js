/**
 * NatureGram's own mail: branded letters for email verification, password resets and a parent's
 * consent for a teenage explorer. Firebase Auth's built-in emails can't carry this voice, so
 * the server sends through a mail provider when one is configured:
 *
 *   RESEND_API_KEY   send through Resend (https://resend.com); the from-domain must be verified there
 *   MAIL_FROM        e.g. "NatureGram <field@thenaturegram.com>" (default)
 *   MAIL_REPLY_TO    optional reply-to address
 *
 * With no provider, sendMail() resolves { sent: false } and callers fall back (Firebase's own
 * email for auth, or a link the explorer can pass on themselves for parental consent).
 */
import https from 'https';

const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://thenaturegram.com').replace(/\/$/, '');
const FROM = process.env.MAIL_FROM || 'NatureGram <field@thenaturegram.com>';
const REPLY_TO = process.env.MAIL_REPLY_TO || '';

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A letter in NatureGram's hand: cream paper, the mark, a serif heading, one clear button, and a
 * line from the naturalist of the fortnight. Table layout and inline styles so it renders in Gmail,
 * Outlook and Apple Mail alike; dark-mode clients keep it legible.
 *
 * @param {{ preheader?: string, heading: string, paragraphs: string[], button?: { label: string, url: string },
 *           after?: string[], quote?: { text: string, by: string }, accent?: string, footnote?: string }} m
 */
export function letterHtml(m) {
  const accent = /^#[0-9a-f]{6}$/i.test(m.accent || '') ? m.accent : '#8a3b12';
  const p = (t) => `<p style="margin:0 0 16px;font:16px/1.6 -apple-system,'Segoe UI',Inter,Arial,sans-serif;color:#44403c">${t}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(m.heading)}</title></head>
<body style="margin:0;padding:0;background:#f3eee4">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eee4"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fcfaf8;border:1px solid #e3d9c6;border-radius:4px">
    <tr><td style="padding:28px 32px 0">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle"><img src="${PUBLIC_ORIGIN}/icon-192.png" width="36" height="36" alt="" style="display:block;border-radius:9px"></td>
        <td style="vertical-align:middle;padding-left:10px;font:italic 600 20px Georgia,'Times New Roman',serif;color:#2f2a22">NatureGram</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:24px 32px 8px">
      <h1 style="margin:0 0 16px;font:500 28px/1.25 Georgia,'Times New Roman',serif;color:#2f2a22">${esc(m.heading)}</h1>
      ${m.paragraphs.map(p).join('')}
      ${m.button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:${accent}">
        <a href="${esc(m.button.url)}" style="display:inline-block;padding:14px 28px;font:600 16px -apple-system,'Segoe UI',Inter,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:999px">${esc(m.button.label)}</a>
      </td></tr></table>` : ''}
      ${(m.after || []).map(p).join('')}
    </td></tr>
    ${m.quote ? `<tr><td style="padding:0 32px 24px"><div style="border-left:2px solid ${accent};padding:4px 0 4px 14px">
      <p style="margin:0;font:italic 17px/1.5 Georgia,'Times New Roman',serif;color:#57534e">“${esc(m.quote.text)}”</p>
      <p style="margin:6px 0 0;font:13px -apple-system,'Segoe UI',Inter,Arial,sans-serif;color:#8a7a60">${esc(m.quote.by)}, naturalist of the fortnight</p>
    </div></td></tr>` : ''}
    <tr><td style="padding:16px 32px 28px;border-top:1px solid #ece4d4">
      <p style="margin:0;font:12px/1.6 -apple-system,'Segoe UI',Inter,Arial,sans-serif;color:#8a7a60">${m.footnote ? esc(m.footnote) + '<br>' : ''}NatureGram · a field notebook for the living world · <a href="${PUBLIC_ORIGIN}/privacy.html" style="color:#8a7a60">Privacy</a></p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/** The same letter as plain text, for clients that don't show HTML. */
export function letterText(m) {
  return [m.heading, '', ...m.paragraphs.map(t => t.replace(/<[^>]+>/g, '')), '',
    ...(m.button ? [`${m.button.label}: ${m.button.url}`, ''] : []),
    ...(m.after || []).map(t => t.replace(/<[^>]+>/g, '')),
    ...(m.quote ? ['', `“${m.quote.text}” — ${m.quote.by}`] : []),
    '', '— NatureGram', `${PUBLIC_ORIGIN}`].join('\n');
}

/** Send one email. Resolves { sent, id?, error? }; never throws. */
export function sendMail({ to, subject, html, text, tags }) {
  if (!mailConfigured()) return Promise.resolve({ sent: false, error: 'no-provider' });
  const body = JSON.stringify({ from: FROM, to: [to], subject, html, text, ...(REPLY_TO ? { reply_to: REPLY_TO } : {}), ...(tags ? { tags } : {}) });
  return new Promise((resolve) => {
    const req = https.request({
      method: 'POST', hostname: 'api.resend.com', path: '/emails', timeout: 10_000,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = ''; res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = {}; try { json = JSON.parse(data); } catch { /* ignore */ }
        resolve(res.statusCode >= 200 && res.statusCode < 300 ? { sent: true, id: json.id } : { sent: false, error: String(json.message || res.statusCode).slice(0, 200) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ sent: false, error: e.message }));
    req.end(body);
  });
}

export const publicOrigin = () => PUBLIC_ORIGIN;
