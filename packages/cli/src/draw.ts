// Draw an agent's marks into a screenshot (J-244): boxes and arrows with numbered badges in
// payload order, text labels, opaque redactions (no badge) and blurred regions. Coordinates are
// image pixels. Pure pixel work on RGBA so the CLI needs no image library.
import { glyph, GLYPH_H, GLYPH_W } from './font.ts';
import type { Image } from './png.ts';

export type Mark =
  | { type: 'box'; x: number; y: number; w: number; h: number; color?: string; note?: string }
  | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; color?: string; note?: string }
  | { type: 'text'; x: number; y: number; text: string; color?: string; size?: number }
  | { type: 'redact'; x: number; y: number; w: number; h: number }
  | { type: 'blur'; x: number; y: number; w: number; h: number; radius?: number };

/** open-toolbar "ink" accent (D-019); marks may override it with a #rrggbb colour. */
export const DEFAULT_MARK_COLOR = '#3446cf';

type RGB = [number, number, number];

export function parseColor(c: string | undefined): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '') ?? /^#?([0-9a-f]{6})$/i.exec(DEFAULT_MARK_COLOR)!;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blend(img: Image, x: number, y: number, c: RGB, a = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  const d = img.data;
  d[o] = Math.round(d[o]! * (1 - a) + c[0] * a);
  d[o + 1] = Math.round(d[o + 1]! * (1 - a) + c[1] * a);
  d[o + 2] = Math.round(d[o + 2]! * (1 - a) + c[2] * a);
  d[o + 3] = 255;
}

export function fillRect(img: Image, x: number, y: number, w: number, h: number, c: RGB, a = 1) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.ceil(x + w));
  const y1 = Math.min(img.height, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) blend(img, xx, yy, c, a);
}

export function strokeRect(img: Image, x: number, y: number, w: number, h: number, c: RGB, t: number) {
  fillRect(img, x, y, w, t, c);
  fillRect(img, x, y + h - t, w, t, c);
  fillRect(img, x, y, t, h, c);
  fillRect(img, x + w - t, y, t, h, c);
}

/** Thick line: a disc of radius t/2 stamped along the segment (anti-aliased edge). */
export function line(img: Image, x1: number, y1: number, x2: number, y2: number, c: RGB, t: number) {
  const r = t / 2;
  const minX = Math.floor(Math.min(x1, x2) - r - 1);
  const maxX = Math.ceil(Math.max(x1, x2) + r + 1);
  const minY = Math.floor(Math.min(y1, y2) - r - 1);
  const maxY = Math.ceil(Math.max(y1, y2) + r + 1);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = Math.max(0, minY); y <= Math.min(img.height - 1, maxY); y++) {
    for (let x = Math.max(0, minX); x <= Math.min(img.width - 1, maxX); x++) {
      const u = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const px = x1 + u * dx - x;
      const py = y1 + u * dy - y;
      const d = Math.sqrt(px * px + py * py);
      if (d <= r - 0.5) blend(img, x, y, c);
      else if (d < r + 0.5) blend(img, x, y, c, r + 0.5 - d);
    }
  }
}

export function disc(img: Image, cx: number, cy: number, radius: number, c: RGB) {
  for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
    for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius - 0.5) blend(img, x, y, c);
      else if (d < radius + 0.5) blend(img, x, y, c, radius + 0.5 - d);
    }
  }
}

export function textWidth(s: string, scale: number) {
  return s.length * (GLYPH_W + 1) * scale - scale;
}

export function drawText(img: Image, x: number, y: number, s: string, c: RGB, scale: number) {
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    for (let r = 0; r < GLYPH_H; r++) for (let col = 0; col < GLYPH_W; col++) if (g[r]![col]) fillRect(img, cx + col * scale, y + r * scale, scale, scale, c);
    cx += (GLYPH_W + 1) * scale;
  }
}

/** Box blur of a region, three passes (close to a Gaussian). */
export function blurRect(img: Image, x: number, y: number, w: number, h: number, radius: number) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.ceil(x + w));
  const y1 = Math.min(img.height, Math.ceil(y + h));
  const W = x1 - x0;
  const H = y1 - y0;
  if (W <= 0 || H <= 0) return;
  const buf = new Float32Array(W * H * 3);
  for (let yy = 0; yy < H; yy++)
    for (let xx = 0; xx < W; xx++) {
      const o = ((y0 + yy) * img.width + x0 + xx) * 4;
      const b = (yy * W + xx) * 3;
      buf[b] = img.data[o]!;
      buf[b + 1] = img.data[o + 1]!;
      buf[b + 2] = img.data[o + 2]!;
    }
  const r = Math.max(1, Math.round(radius));
  const pass = (horizontal: boolean) => {
    const src = buf.slice();
    const n = horizontal ? W : H;
    const m = horizontal ? H : W;
    for (let j = 0; j < m; j++) {
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        let cnt = 0;
        const at = (i: number) => (horizontal ? (j * W + i) * 3 + ch : (i * W + j) * 3 + ch);
        for (let i = -r; i <= r; i++) if (i >= 0 && i < n) {
          acc += src[at(i)]!;
          cnt++;
        }
        for (let i = 0; i < n; i++) {
          buf[at(i)] = acc / cnt;
          const out = i - r;
          const inn = i + r + 1;
          if (out >= 0) {
            acc -= src[at(out)]!;
            cnt--;
          }
          if (inn < n) {
            acc += src[at(inn)]!;
            cnt++;
          }
        }
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(true);
    pass(false);
  }
  for (let yy = 0; yy < H; yy++)
    for (let xx = 0; xx < W; xx++) {
      const o = ((y0 + yy) * img.width + x0 + xx) * 4;
      const b = (yy * W + xx) * 3;
      img.data[o] = Math.round(buf[b]!);
      img.data[o + 1] = Math.round(buf[b + 1]!);
      img.data[o + 2] = Math.round(buf[b + 2]!);
    }
}

const WHITE: RGB = [255, 255, 255];

function badge(img: Image, cx: number, cy: number, n: number, c: RGB, unit: number) {
  const label = String(n);
  const scale = Math.max(2, Math.round(unit * 0.9));
  const radius = Math.max(textWidth(label, scale), GLYPH_H * scale) / 2 + scale * 2;
  const x = Math.min(Math.max(cx, radius + 1), img.width - radius - 1);
  const y = Math.min(Math.max(cy, radius + 1), img.height - radius - 1);
  disc(img, x, y, radius + scale * 0.75, WHITE);
  disc(img, x, y, radius, c);
  drawText(img, x - textWidth(label, scale) / 2, y - (GLYPH_H * scale) / 2, label, WHITE, scale);
}

/**
 * Draw marks in order. Boxes and arrows get badges numbered 1, 2, ... in payload order;
 * redactions and blurs draw first so nothing is drawn over hidden pixels by accident; text
 * labels get none. Returns the badge numbers per mark index.
 */
export function drawMarks(img: Image, marks: Mark[]): (number | null)[] {
  const unit = Math.max(2, Math.round(Math.min(img.width, img.height) / 400));
  for (const m of marks) {
    if (m.type === 'blur') blurRect(img, m.x, m.y, m.w, m.h, m.radius ?? Math.max(6, unit * 5));
    else if (m.type === 'redact') fillRect(img, m.x, m.y, m.w, m.h, [17, 17, 17]);
  }
  const numbers: (number | null)[] = [];
  let n = 0;
  for (const m of marks) {
    if (m.type === 'box') {
      const c = parseColor(m.color);
      strokeRect(img, m.x, m.y, m.w, m.h, c, unit * 2);
      badge(img, m.x, m.y, ++n, c, unit * 2);
      numbers.push(n);
    } else if (m.type === 'arrow') {
      const c = parseColor(m.color);
      const t = unit * 2;
      line(img, m.x1, m.y1, m.x2, m.y2, c, t);
      const ang = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
      const head = t * 5;
      for (const s of [-1, 1]) line(img, m.x2, m.y2, m.x2 - head * Math.cos(ang + s * 0.45), m.y2 - head * Math.sin(ang + s * 0.45), c, t);
      badge(img, m.x1, m.y1, ++n, c, t);
      numbers.push(n);
    } else if (m.type === 'text') {
      const c = parseColor(m.color);
      const scale = Math.max(2, Math.round(m.size ? m.size / GLYPH_H : unit * 1.5));
      const w = textWidth(m.text, scale);
      fillRect(img, m.x - scale * 2, m.y - scale * 2, w + scale * 4, GLYPH_H * scale + scale * 4, c);
      drawText(img, m.x, m.y, m.text, WHITE, scale);
      numbers.push(null);
    } else numbers.push(null);
  }
  return numbers;
}
