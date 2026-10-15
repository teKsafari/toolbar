// Images for the feedback folder: everything at 1x CSS pixels (PLAN "Images at 1x CSS pixels"),
// annotation drawings burned into the element crop, and crops of canvas regions for OCR.
import sharp from 'sharp';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** PNG at 1x CSS pixels: a capture taken at devicePixelRatio `dpr` is scaled down by it. */
export async function toCssPixels(img: Uint8Array, dpr: number, maxWidth = 2560): Promise<{ png: Buffer; width: number; height: number }> {
  const s = sharp(img, { failOn: 'none' });
  const meta = await s.metadata();
  const w0 = meta.width ?? 0;
  const ratio = dpr > 1.01 ? 1 / dpr : 1;
  const w = Math.max(1, Math.min(maxWidth, Math.round(w0 * ratio)));
  const out = w !== w0 ? s.resize({ width: w }) : s;
  const { data, info } = await out.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

/** Crop a region (image pixels), clamped to the image. Null when nothing is left. */
export async function cropRegion(img: Uint8Array, r: Rect): Promise<Buffer | null> {
  const meta = await sharp(img, { failOn: 'none' }).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const w = Math.min(W - x, Math.ceil(r.w));
  const h = Math.min(H - y, Math.ceil(r.h));
  if (w < 4 || h < 4) return null;
  return sharp(img, { failOn: 'none' }).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
}

const COLORS: Record<string, string> = { red: '#e5484d', marker: '#f5a524', yellow: '#f5d90a', green: '#30a46c', blue: '#0090ff', black: '#111111', white: '#ffffff' };
const color = (c: unknown) => {
  const s = typeof c === 'string' ? c : '#e5484d';
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  return COLORS[s] ?? '#e5484d';
};
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * SVG markup for annotation shapes in image coordinates. Reads the editor's shape model
 * (`packages/ui/src/editor/shapes.ts`: rect, ellipse, blur, pen, line, arrow, text) and the older
 * `{ from, to, stroke }` arrow form the seed uses. Unknown shapes are skipped.
 */
export function shapesSvg(shapes: readonly Record<string, unknown>[], scale = 1): string {
  const out: string[] = [];
  for (const s of shapes) {
    const c = color(s.color);
    const sw = Math.max(1, num(s.sw, num(s.stroke, 4))) * scale;
    const rot = num(s.rot);
    const type = String(s.type ?? '');
    let el = '';
    let cx = 0;
    let cy = 0;
    if (type === 'rect' || type === 'ellipse' || type === 'blur') {
      const x = num(s.x) * scale;
      const y = num(s.y) * scale;
      const w = num(s.w) * scale;
      const h = num(s.h) * scale;
      cx = x + w / 2;
      cy = y + h / 2;
      if (type === 'rect') el = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(sw * 2, w / 2, h / 2)}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
      else if (type === 'ellipse') el = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
      else el = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#888" fill-opacity="0.92"/>`;
    } else if (type === 'line' || type === 'arrow') {
      const from = (s.from as { x?: number; y?: number } | undefined) ?? null;
      const to = (s.to as { x?: number; y?: number } | undefined) ?? null;
      const x1 = num(s.x1, num(from?.x)) * scale;
      const y1 = num(s.y1, num(from?.y)) * scale;
      const x2 = num(s.x2, num(to?.x)) * scale;
      const y2 = num(s.y2, num(to?.y)) * scale;
      const bend = num(s.bend) * scale;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = -(y2 - y1) / len;
      const ny = (x2 - x1) / len;
      const mx = (x1 + x2) / 2 + nx * bend;
      const my = (y1 + y2) / 2 + ny * bend;
      const qx = 2 * mx - (x1 + x2) / 2;
      const qy = 2 * my - (y1 + y2) / 2;
      cx = (x1 + x2) / 2;
      cy = (y1 + y2) / 2;
      el = `<path d="M${x1} ${y1} Q${qx} ${qy} ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
      if (type === 'arrow') {
        // head along the tangent at the end (from the control point to the end)
        const dx = x2 - qx;
        const dy = y2 - qy;
        const dl = Math.hypot(dx, dy) || 1;
        const ux = dx / dl;
        const uy = dy / dl;
        const head = Math.max(10, sw * 3.2);
        const ax = x2 - ux * head - uy * head * 0.55;
        const ay = y2 - uy * head + ux * head * 0.55;
        const bx = x2 - ux * head + uy * head * 0.55;
        const by = y2 - uy * head - ux * head * 0.55;
        el += `<path d="M${ax} ${ay} L${x2} ${y2} L${bx} ${by}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
    } else if (type === 'pen') {
      const pts = Array.isArray(s.pts) ? (s.pts as number[][]) : [];
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${num(p[0]) * scale} ${num(p[1]) * scale}`).join(' ');
      cx = num(pts[0]![0]) * scale;
      cy = num(pts[0]![1]) * scale;
      el = `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (type === 'text') {
      const text = String(s.text ?? '');
      if (!text) continue;
      const size = num(s.size, 18) * scale;
      const x = num(s.x) * scale;
      const y = num(s.y) * scale;
      const lines = text.split('\n');
      const w = num(s.w) * scale || Math.max(...lines.map((l) => l.length)) * size * 0.6 + size;
      const h = num(s.h) * scale || lines.length * size * 1.25 + size * 0.6;
      cx = x + w / 2;
      cy = y + h / 2;
      el = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${size * 0.3}" fill="${c}"/>`;
      el += lines
        .map((l, i) => `<text x="${x + size * 0.5}" y="${y + size * 0.3 + size * (i + 0.95) * 1.25 - size * 0.25}" font-family="sans-serif" font-weight="700" font-size="${size}" fill="#ffffff">${esc(l)}</text>`)
        .join('');
    } else continue;
    out.push(rot ? `<g transform="rotate(${(rot * 180) / Math.PI} ${cx} ${cy})">${el}</g>` : el);
  }
  return out.join('');
}

/** Burn shapes (image coordinates of `img`) into the image. */
export async function flatten(img: Uint8Array, shapes: readonly Record<string, unknown>[]): Promise<Buffer> {
  const meta = await sharp(img, { failOn: 'none' }).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const inner = shapesSvg(shapes);
  if (!inner) return sharp(img, { failOn: 'none' }).png().toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
  return sharp(img, { failOn: 'none' })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

export async function sizeOf(img: Uint8Array): Promise<{ width: number; height: number }> {
  const m = await sharp(img, { failOn: 'none' }).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}

/** A video frame (JPEG) as PNG at the page's CSS width. */
export async function frameToCss(jpeg: Uint8Array, cssWidth: number | null): Promise<Buffer> {
  const s = sharp(jpeg, { failOn: 'none' });
  return (cssWidth ? s.resize({ width: Math.round(cssWidth), withoutEnlargement: true }) : s).png().toBuffer();
}
