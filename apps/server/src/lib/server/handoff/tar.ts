// A small POSIX ustar writer for the feedback folder (PLAN "Hand-off to the agent"): regular files
// and directories, paths split into prefix and name, a PAX header for anything longer. Enough for
// `tar xz` from GNU tar, bsdtar and busybox; no dependency.
import { gzipSync } from 'node:zlib';

export interface TarEntry {
  path: string;
  data: Uint8Array | string;
  /** seconds since the epoch */
  mtime?: number;
}

const BLOCK = 512;
const enc = new TextEncoder();

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function writeStr(buf: Uint8Array, off: number, s: string, len: number) {
  const b = enc.encode(s);
  buf.set(b.subarray(0, len), off);
}

/** Split a path into ustar prefix (<= 155 bytes) and name (<= 100 bytes), or null when it cannot fit. */
export function splitPath(path: string): { prefix: string; name: string } | null {
  const bytes = enc.encode(path).length;
  if (bytes <= 100) return { prefix: '', name: path };
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== '/') continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (enc.encode(prefix).length <= 155 && enc.encode(name).length <= 100 && name) return { prefix, name };
  }
  return null;
}

function header(path: string, size: number, type: '0' | '5' | 'x', mtime: number): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const split = splitPath(path) ?? { prefix: '', name: path.slice(-100) };
  writeStr(h, 0, split.name, 100);
  writeStr(h, 100, octal(type === '5' ? 0o755 : 0o644, 8), 8);
  writeStr(h, 108, octal(0, 8), 8);
  writeStr(h, 116, octal(0, 8), 8);
  writeStr(h, 124, octal(size, 12), 12);
  writeStr(h, 136, octal(Math.floor(mtime), 12), 12);
  h.fill(0x20, 148, 156); // checksum field counts as spaces
  writeStr(h, 156, type, 1);
  writeStr(h, 257, 'ustar\0', 6);
  writeStr(h, 263, '00', 2);
  writeStr(h, 345, split.prefix, 155);
  let sum = 0;
  for (const b of h) sum += b;
  writeStr(h, 148, sum.toString(8).padStart(6, '0') + '\0 ', 8);
  return h;
}

function pad(size: number): Uint8Array {
  const r = size % BLOCK;
  return new Uint8Array(r ? BLOCK - r : 0);
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = enc.encode(body).length + 1;
  while (String(len).length + enc.encode(body).length !== len) len = String(len).length + enc.encode(body).length;
  return `${len}${body}`;
}

/**
 * The tar blocks of one entry: a header for every parent directory not in `dirs` yet (added to it),
 * a PAX header when the path does not fit ustar, the file header, the data and its padding. The
 * streaming export writes these one entry at a time.
 */
export function tarEntryParts(e: TarEntry, dirs: Set<string>, mtime = Math.floor(Date.now() / 1000)): Uint8Array[] {
  const parts: Uint8Array[] = [];
  const segs = e.path.split('/');
  for (let i = 1; i < segs.length; i++) {
    const d = segs.slice(0, i).join('/') + '/';
    if (dirs.has(d)) continue;
    dirs.add(d);
    parts.push(header(d, 0, '5', e.mtime ?? mtime));
  }
  const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
  if (!splitPath(e.path)) {
    const pax = enc.encode(paxRecord('path', e.path));
    parts.push(header(`PaxHeader/${e.path.slice(-80)}`, pax.length, 'x', e.mtime ?? mtime), pax, pad(pax.length));
  }
  parts.push(header(e.path, data.length, '0', e.mtime ?? mtime), data, pad(data.length));
  return parts;
}

/** The two zero blocks that end an archive. */
export const tarEnd = () => new Uint8Array(BLOCK * 2);

/** The tar archive (uncompressed) of the entries; directories are added for every parent. */
export function tar(entries: TarEntry[], mtime = Math.floor(Date.now() / 1000)): Uint8Array {
  const parts: Uint8Array[] = [];
  const dirs = new Set<string>();
  for (const e of entries) parts.push(...tarEntryParts(e, dirs, mtime));
  parts.push(tarEnd());
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export const tarGz = (entries: TarEntry[], mtime?: number) => gzipSync(tar(entries, mtime), { level: 6 });

/** Read a tar back (tests, and the MCP file reader on a cached archive). Regular files only. */
export function untar(buf: Uint8Array): { path: string; data: Uint8Array }[] {
  const out: { path: string; data: Uint8Array }[] = [];
  const dec = new TextDecoder();
  let off = 0;
  let paxPath: string | null = null;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, l: number) => dec.decode(h.subarray(a, a + l)).replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = str(156, 1) || '0';
    const prefix = str(345, 155);
    const name = str(0, 100);
    const data = buf.subarray(off + BLOCK, off + BLOCK + size);
    if (type === 'x') {
      const m = dec.decode(data).match(/ path=([^\n]*)\n/);
      paxPath = m ? m[1]! : null;
    } else if (type === '0') {
      out.push({ path: paxPath ?? (prefix ? `${prefix}/${name}` : name), data });
      paxPath = null;
    }
    off += BLOCK + size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
  return out;
}
