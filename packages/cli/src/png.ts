// Minimal PNG codec on node:zlib for the CLI's annotated screenshots (J-244): decodes 8-bit
// grey, grey+alpha, RGB, RGBA and palette images without interlace, and encodes RGBA.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA, row-major */
  data: Uint8Array;
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(buf: Uint8Array): boolean {
  return buf.length > 8 && SIG.every((b, i) => buf[i] === b);
}

export function decodePng(input: Uint8Array): Image {
  const buf = Buffer.from(input);
  if (!isPng(buf)) throw new Error('Not a PNG file');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (depth !== 8 && !(depth === 16 && colorType !== 3)) throw new Error(`PNG bit depth ${depth} is not supported; save the image as 8 or 16-bit`);
  if (interlace) throw new Error('Interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`PNG colour type ${colorType} is not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpc = depth / 8;
  const bpp = channels * bpc;
  const stride = width * bpp;
  const full = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = line[i]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    full.set(cur, y * stride);
    prev = cur;
  }
  // 16-bit samples keep their high byte
  const px = bpc === 1 ? full : full.filter((_, i) => i % 2 === 0);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const o = i * 4;
    if (colorType === 6) out.set(px.subarray(j, j + 4), o);
    else if (colorType === 2) {
      out[o] = px[j]!;
      out[o + 1] = px[j + 1]!;
      out[o + 2] = px[j + 2]!;
      out[o + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      out[o] = out[o + 1] = out[o + 2] = px[j]!;
      out[o + 3] = colorType === 4 ? px[j + 1]! : 255;
    } else {
      const k = px[j]!;
      out[o] = palette![k * 3]!;
      out[o + 1] = palette![k * 3 + 1]!;
      out[o + 2] = palette![k * 3 + 2]!;
      out[o + 3] = trns && k < trns.length ? trns[k]! : 255;
    }
  }
  return { width, height, data: out };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(img: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]);
}
