// The card image of a capture that has no picture to take one from (D-183): a DOM-only replay or
// a trace without a keyframe from before the extension sent stills, and injector captures, whose
// page bundle cannot take a screenshot. Drawn as SVG and rasterised with sharp (librsvg): a
// browser window with the page's host in the address bar, the capture kind, the page title and
// the path. Light palette of @toolbar/ui (D-175), 640x400 like the other thumbnails (16:10, the
// grid card's ratio); the lower band stays empty for the card's author and duration chips.
import sharp from 'sharp';

export const THUMB_W = 640;
export const THUMB_H = 400;

const KIND_LABEL: Record<string, string> = {
  replay: 'DOM replay',
  trace: 'Trace',
  video: 'Recording',
  screen: 'Screen recording',
  screenshot: 'Screenshot',
  feedback: 'Reviewer notes',
  link: 'Link',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Words into at most `lines` lines of about `width` characters; the last line ends in an ellipsis when cut. */
export function wrap(text: string, width: number, lines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w0 of words) {
    const w = w0.length > width ? `${w0.slice(0, width - 1)}…` : w0;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
      if (out.length === lines) break;
    }
  }
  if (cur && out.length < lines) out.push(cur);
  const used = out.join(' ').split(' ').length;
  if (used < words.length && out.length) {
    const last = out[out.length - 1]!;
    out[out.length - 1] = `${last.length > width - 1 ? last.slice(0, width - 1).trimEnd() : last}…`;
  }
  return out;
}

function fmtDuration(ms: number | null | undefined): string | null {
  if (!ms || ms < 1000) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface PlaceholderInput {
  kind: string;
  pageUrl: string | null;
  pageTitle: string | null;
  title: string | null;
  durationMs?: number | null;
}

export function placeholderSvg(p: PlaceholderInput): string {
  let host = '';
  let path = '';
  try {
    if (p.pageUrl) {
      const u = new URL(p.pageUrl);
      host = u.host;
      path = u.pathname + (u.search ? '?…' : '');
    }
  } catch {
    host = p.pageUrl ?? '';
  }
  const heading = (p.pageTitle || p.title || host || 'Untitled page').trim();
  const kind = KIND_LABEL[p.kind] ?? p.kind;
  const dur = fmtDuration(p.durationMs);
  const badge = dur ? `${kind} · ${dur}` : kind;
  const lines = wrap(heading, 34, 2);
  const font = `font-family="Inter, 'DejaVu Sans', 'Liberation Sans', Helvetica, Arial, sans-serif"`;
  const badgeW = Math.round(badge.length * 8.4 + 28);
  const title = lines
    .map((l, i) => `<text x="64" y="${168 + i * 34}" ${font} font-size="26" font-weight="600" fill="#111827">${esc(l)}</text>`)
    .join('');
  const pathY = 168 + lines.length * 34 + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_W}" height="${THUMB_H}" viewBox="0 0 ${THUMB_W} ${THUMB_H}">
<rect width="${THUMB_W}" height="${THUMB_H}" fill="#f3f4f6"/>
<rect x="32.5" y="28.5" width="575" height="300" rx="14" fill="#ffffff" stroke="#e5e7eb"/>
<path d="M33 70.5 H607" stroke="#e5e7eb"/>
<circle cx="58" cy="50" r="5.5" fill="#d1d5db"/><circle cx="76" cy="50" r="5.5" fill="#d1d5db"/><circle cx="94" cy="50" r="5.5" fill="#d1d5db"/>
<rect x="116" y="38" width="468" height="24" rx="12" fill="#f3f4f6"/>
<text x="132" y="55" ${font} font-size="14" fill="#4b5563">${esc(host.length > 52 ? `${host.slice(0, 51)}…` : host || 'page')}</text>
<rect x="64" y="94" width="${badgeW}" height="28" rx="14" fill="#111827"/>
<text x="78" y="113" ${font} font-size="14" font-weight="500" fill="#fafafa">${esc(badge)}</text>
${title}
${path && path !== '/' ? `<text x="64" y="${pathY}" ${font} font-size="16" fill="#6b7280">${esc(path.length > 56 ? `${path.slice(0, 55)}…` : path)}</text>` : ''}
<rect x="64" y="${pathY + 24}" width="300" height="10" rx="5" fill="#e5e7eb"/>
<rect x="64" y="${pathY + 44}" width="220" height="10" rx="5" fill="#eef0f3"/>
</svg>`;
}

/** The placeholder card as WebP, the format of every thumbnail. */
export async function placeholderThumb(p: PlaceholderInput): Promise<Buffer> {
  return sharp(Buffer.from(placeholderSvg(p))).webp({ quality: 85 }).toBuffer();
}
