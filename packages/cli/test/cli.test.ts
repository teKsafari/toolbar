// CLI units: PNG codec, mark drawing (J-244), zip and Playwright trace import (J-245), ids, config.
import { describe, expect, it } from 'vitest';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePng, encodePng, isPng, type Image } from '../src/png.ts';
import { drawMarks, parseColor } from '../src/draw.ts';
import { readZip } from '../src/zip.ts';
import { parseTrace } from '../src/trace.ts';
import { uuidv7 } from '../src/upload.ts';
import { readConfig, writeConfig } from '../src/config.ts';
import { main } from '../src/main.ts';

const blank = (w: number, h: number, v = 255): Image => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(v) });
const px = (img: Image, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

/** A zip with deflated entries, for the reader and the trace import. */
function makeZip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = deflateRawSync(data);
    const nameB = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, nameB, comp);
    centrals.push(ch, nameB);
    off += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('png', () => {
  it('round-trips RGBA', () => {
    const img = blank(7, 5, 0);
    img.data.set([10, 20, 30, 255], (2 * 7 + 3) * 4);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(7);
    expect(px(back, 3, 2)).toEqual([10, 20, 30, 255]);
    expect(isPng(encodePng(img))).toBe(true);
  });

  it('decodes 8-bit RGB with Sub and Up filters', () => {
    // 2x2 RGB: rows filtered with Sub (1) and Up (2)
    const raw = Buffer.from([1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 2, 2, 2]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const chunk = (t: string, d: Buffer) => {
      const l = Buffer.alloc(4);
      l.writeUInt32BE(d.length);
      return Buffer.concat([l, Buffer.from(t), d, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    const img = decodePng(png);
    expect(px(img, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(img, 1, 0)).toEqual([15, 25, 35, 255]);
    expect(px(img, 0, 1)).toEqual([11, 21, 31, 255]);
    expect(px(img, 1, 1)).toEqual([17, 27, 37, 255]);
  });
});

describe('marks (J-244)', () => {
  it('numbers boxes and arrows in payload order, not redactions or text', () => {
    const img = blank(400, 300);
    const n = drawMarks(img, [
      { type: 'redact', x: 0, y: 0, w: 20, h: 20 },
      { type: 'box', x: 50, y: 50, w: 100, h: 60 },
      { type: 'text', x: 200, y: 200, text: 'hi' },
      { type: 'arrow', x1: 300, y1: 250, x2: 200, y2: 150, color: '#d4380d' },
      { type: 'blur', x: 250, y: 10, w: 50, h: 50 },
    ]);
    expect(n).toEqual([null, 1, null, 2, null]);
    expect(px(img, 10, 10)).toEqual([17, 17, 17, 255]);
    // the box outline uses the ink colour
    expect(px(img, 100, 109).slice(0, 3)).toEqual(parseColor(undefined));
    // inside the box is untouched
    expect(px(img, 100, 80)).toEqual([255, 255, 255, 255]);
  });

  it('blurs a sharp edge', () => {
    const img = blank(40, 10);
    for (let y = 0; y < 10; y++) for (let x = 20; x < 40; x++) img.data.set([0, 0, 0, 255], (y * 40 + x) * 4);
    drawMarks(img, [{ type: 'blur', x: 0, y: 0, w: 40, h: 10, radius: 3 }]);
    const mid = px(img, 20, 5)[0]!;
    expect(mid).toBeGreaterThan(30);
    expect(mid).toBeLessThan(225);
  });
});

describe('zip and Playwright trace (J-245)', () => {
  it('reads deflated entries', () => {
    const z = readZip(makeZip({ 'a.txt': 'hello', 'dir/b.txt': 'world' }));
    expect(z.get('a.txt')!.toString()).toBe('hello');
    expect(z.get('dir/b.txt')!.toString()).toBe('world');
  });

  it('maps trace actions, console, errors and network to events with secrets masked', () => {
    const wall = 1_800_000_000_000;
    const trace = [
      { type: 'context-options', browserName: 'chromium', wallTime: wall, monotonicTime: 1000, options: { viewport: { width: 1280, height: 720 } }, playwrightVersion: '1.63.0' },
      { type: 'event', method: 'page', time: 1100, class: 'BrowserContext' },
      { type: 'before', callId: 'c1', startTime: 1200, method: 'goto', apiName: 'page.goto', params: { url: 'http://lab.test/form' } },
      { type: 'before', callId: 'c2', startTime: 1500, method: 'fill', params: { selector: 'input[name="password"]', value: 'hunter2' } },
      { type: 'before', callId: 'c3', startTime: 1600, method: 'fill', params: { selector: 'input[name="email"]', value: 'a@b.test' } },
      { type: 'before', callId: 'c4', startTime: 1700, method: 'click', params: { selector: 'internal:testid=[data-testid="send"s]' } },
      { type: 'console', time: 1800, messageType: 'error', text: 'boom', location: { url: 'http://lab.test/app.js', lineNumber: 9, columnNumber: 4 } },
      { type: 'event', method: 'pageError', time: 1900, params: { error: { error: { name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined' } } } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const network = JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        _monotonicTime: 1750,
        time: 40,
        request: { method: 'POST', url: 'http://lab.test/api/send', headers: [{ name: 'Authorization', value: 'Bearer x' }], postData: { text: '{"a":1}' } },
        response: { status: 403, statusText: 'Forbidden', headers: [{ name: 'content-type', value: 'application/json' }], content: { mimeType: 'application/json', size: 20, _sha1: 'abc.json' } },
      },
    });
    const r = parseTrace(makeZip({ 'trace.trace': trace, 'trace.network': network, 'resources/abc.json': '{"error":"csrf"}' }));
    expect(r.startedAt).toBe(wall + 100);
    expect(r.firstUrl).toBe('http://lab.test/form');
    expect(r.stats).toEqual({ console: 1, errors: 1, requests: 1, actions: 3 });
    const inputs = r.events.filter((e) => e.kind === 'user' && e.data.type === 'input');
    expect(inputs[0]!.data).toMatchObject({ masked: true });
    expect(JSON.stringify(inputs[0])).not.toContain('hunter2');
    expect(inputs[1]!.data).toMatchObject({ value: 'a@b.test' });
    const click = r.events.find((e) => e.kind === 'user' && e.data.type === 'click')!;
    expect((click.data as { target?: { testId?: string } }).target?.testId).toBe('send');
    const res = r.events.find((e) => e.kind === 'net.res')!;
    expect(res.data).toMatchObject({ status: 403, body: '{"error":"csrf"}' });
    const req = r.events.find((e) => e.kind === 'net.req')!;
    expect((req.data as { headers: Record<string, string> }).headers.authorization).toBe('[redacted]');
    expect(r.events.find((e) => e.kind === 'media' && e.data.op === 'start')!.t).toBe(wall + 100);
    expect(r.events.filter((e) => e.kind === 'error')).toHaveLength(1);
  });
});

describe('ids and config', () => {
  it('makes v7 uuids that sort by time', () => {
    const a = uuidv7(1_000_000);
    const b = uuidv7(2_000_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('stores the sign-in with mode 600 and lets env override it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nibcfg-'));
    process.env.NIB_CONFIG = join(dir, 'c.json');
    delete process.env.NIB_TOKEN;
    await writeConfig({ server: 'http://x.test/', token: 'tb_pat_x', via: 'token' });
    expect((await readConfig())!.server).toBe('http://x.test');
    process.env.NIB_SERVER = 'http://y.test';
    process.env.NIB_TOKEN = 'tb_pat_y';
    expect(await readConfig()).toEqual({ server: 'http://y.test', token: 'tb_pat_y', via: 'token' });
    delete process.env.NIB_SERVER;
    delete process.env.NIB_TOKEN;
    const { stat } = await import('node:fs/promises');
    expect((await stat(process.env.NIB_CONFIG!)).mode & 0o777).toBe(0o600);
  });

  it('installs the skill with the read order (J-247)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nibskill-'));
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (writes.push(s), true)) as typeof process.stdout.write;
    try {
      await main(['skill', 'install', '--dir', dir]);
    } finally {
      process.stdout.write = orig;
    }
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8');
    expect(text).toMatch(/1\. `nib get/);
    expect(text).toMatch(/2\. `nib network .*--status 4xx,5xx,failed/);
    expect(text).toMatch(/3\. `nib frames/);
    expect(text).toContain('nib comment');
    expect(writes.join('')).toContain('SKILL.md');
  });
});
