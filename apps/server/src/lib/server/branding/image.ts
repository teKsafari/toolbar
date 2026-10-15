// Logo files (D-112): SVG sanitising and PNG renditions. An uploaded SVG is cleaned with
// DOMPurify; one with scripts, event handlers, embedded HTML or references outside the file is
// refused instead of silently changed. sharp renders the cleaned SVG (or a PNG) into the
// favicon, apple-touch, extension and email sizes.
import { createHash } from 'node:crypto';
import DOMPurify from 'isomorphic-dompurify';
import sharp from 'sharp';
import { BRAND_ICON_SIZES, BRAND_LOGO_MAX_BYTES, BRAND_PNG_MAX_SIDE, type BrandIconSize, type LogoRef } from '@toolbar/shared/api';

export class BrandImageError extends Error {
  constructor(
    readonly code: 'too_large' | 'unsupported_media_type' | 'invalid_image',
    message: string,
  ) {
    super(message);
  }
}

/** Elements that can run code, embed HTML or pull in other files. */
const DANGEROUS_TAGS = ['script', 'foreignobject', 'style', 'a', 'image', 'use', 'iframe', 'object', 'embed', 'audio', 'video', 'feimage', 'animate', 'set', 'animatemotion', 'animatetransform', 'handler', 'listener'];

const isLocalRef = (v: string) => /^\s*#/.test(v);
const URL_IN_CSS = /url\(\s*['"]?\s*(?!#)[^)]*\)|@import|expression\(/i;

export interface CleanSvg {
  svg: string;
  width: number;
  height: number;
}

function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1];
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb && vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) return { width: vb[2]!, height: vb[3]! };
  const w = parseFloat(attr('width') ?? '');
  const h = parseFloat(attr('height') ?? '');
  return w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** Clean an SVG logo, or throw BrandImageError('invalid_image') with the reason. */
export function sanitizeSvg(input: string): CleanSvg {
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new BrandImageError('invalid_image', 'This SVG declares a DOCTYPE or entities. Export it again as plain SVG.');
  if (!/<svg\b/i.test(input)) throw new BrandImageError('invalid_image', 'This file is not an SVG image.');
  const problems = new Set<string>();
  const onAttr = (_node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    const n = data.attrName.toLowerCase();
    if (n.startsWith('on')) {
      problems.add('event handlers');
      data.keepAttr = false;
    } else if ((n === 'href' || n === 'xlink:href') && !isLocalRef(data.attrValue)) {
      problems.add('links to other files');
      data.keepAttr = false;
    } else if (URL_IN_CSS.test(data.attrValue) && !/^url\(\s*['"]?#/i.test(data.attrValue.trim())) {
      problems.add('references to other files');
      data.keepAttr = false;
    }
  };
  const onElement = (node: Node, data: { tagName: string }) => {
    if (DANGEROUS_TAGS.includes(data.tagName.toLowerCase())) problems.add(data.tagName.toLowerCase() === 'script' ? 'scripts' : `<${data.tagName}> elements`);
    void node;
  };
  DOMPurify.addHook('uponSanitizeAttribute', onAttr as never);
  DOMPurify.addHook('uponSanitizeElement', onElement as never);
  let svg: string;
  try {
    svg = DOMPurify.sanitize(input, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['foreignObject', 'script', 'style', 'a', 'image', 'use', 'feImage'],
      ALLOW_DATA_ATTR: false,
    }) as unknown as string;
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
    DOMPurify.removeHook('uponSanitizeElement');
  }
  if (problems.size) throw new BrandImageError('invalid_image', `This SVG has ${[...problems].join(', ')}. Use a plain vector logo.`);
  const size = svgSize(svg);
  if (!size) throw new BrandImageError('invalid_image', 'This SVG has no viewBox or width and height.');
  if (!/^<svg\b[^>]*\bxmlns=/i.test(svg)) svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return { svg, ...size };
}

export interface LogoFiles {
  ref: LogoRef;
  /** the stored original: sanitised SVG text or the PNG as uploaded */
  original: Buffer;
  icons: Record<BrandIconSize, Buffer>;
  email: Buffer;
}

const sniffPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const looksSvg = (b: Uint8Array) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(Buffer.from(b.subarray(0, 4096)).toString('utf8'));

/** Square icons on a transparent canvas and the email logo (64 px high, at most 320 wide). */
export async function renditions(source: Buffer, isSvg: boolean): Promise<{ icons: Record<BrandIconSize, Buffer>; email: Buffer }> {
  const img = () => sharp(source, isSvg ? { density: 1200 } : {});
  const icons = {} as Record<BrandIconSize, Buffer>;
  for (const n of BRAND_ICON_SIZES) {
    icons[n] = await img()
      .resize(n, n, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  const email = await img()
    .resize(320, 64, { fit: 'inside', withoutEnlargement: !isSvg })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { icons, email };
}

/** Validate an uploaded or fetched logo and make every file the server serves for it. */
export async function processLogo(bytes: Uint8Array, declaredType?: string | null): Promise<LogoFiles> {
  if (bytes.byteLength > BRAND_LOGO_MAX_BYTES) throw new BrandImageError('too_large', 'The logo is larger than 512 KB.');
  const type = sniffPng(bytes) ? 'image/png' : looksSvg(bytes) ? 'image/svg+xml' : null;
  if (!type || (declaredType && !['image/png', 'image/svg+xml', 'application/octet-stream', ''].includes(declaredType.split(';')[0]!.trim())))
    throw new BrandImageError('unsupported_media_type', 'Use an SVG or PNG file.');
  if (type === 'image/svg+xml') {
    const clean = sanitizeSvg(Buffer.from(bytes).toString('utf8'));
    const original = Buffer.from(clean.svg, 'utf8');
    let r: Awaited<ReturnType<typeof renditions>>;
    try {
      r = await renditions(original, true);
    } catch {
      throw new BrandImageError('invalid_image', 'This SVG could not be drawn.');
    }
    const hash = createHash('sha256').update(original).digest('hex');
    return { ref: { hash, type, width: Math.round(clean.width), height: Math.round(clean.height) }, original, ...r };
  }
  const original = Buffer.from(bytes);
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(original).metadata();
  } catch {
    throw new BrandImageError('invalid_image', 'This PNG could not be read.');
  }
  if (meta.format !== 'png' || !meta.width || !meta.height) throw new BrandImageError('invalid_image', 'This PNG could not be read.');
  if (meta.width > BRAND_PNG_MAX_SIDE || meta.height > BRAND_PNG_MAX_SIDE) throw new BrandImageError('invalid_image', 'The PNG is larger than 2048 by 2048 pixels.');
  const r = await renditions(original, false);
  const hash = createHash('sha256').update(original).digest('hex');
  return { ref: { hash, type, width: meta.width, height: meta.height }, original, ...r };
}
