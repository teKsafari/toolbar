// End-to-end checks for the server-core rows (docs/tasks.md), against a running server with the
// seed loaded (scripts/area-setup.sh server-core --seed, then `pnpm dev`). Uses HTTP like curl
// does, and reads S3 and the database directly only to prove what the API cannot show (purge).
//
//   set -a; . ../../.env; set +a; node scripts/check-server-core.ts [section ...]
//
// Sections: upload share access trim draft delete private renditions transcript chapters (default:
// all but chapters, which needs AI_PROVIDER set on the server).
// fixtures/voice.webm is espeak-ng reading a short bug report, encoded with ffmpeg (libopus 32k).
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { TOKEN_PREFIX, type CaptureEvent } from '@toolbar/shared';
import { db, sqlClient } from '../src/lib/server/db/index.ts';
import * as t from '../src/lib/server/db/schema/index.ts';
import { env } from '../src/lib/server/env.ts';
import { keys, listKeys } from '../src/lib/server/s3.ts';
import { hashToken } from '../src/lib/server/tokens.ts';
import { visibleCapturesWhere, visibleFoldersWhere } from '../src/lib/server/share/access.ts';
import { and } from 'drizzle-orm';
import { tabVideoEvents } from '../fixtures/events.ts';

const S = process.env.SERVER_URL || env.publicUrl;
const PAT = `${TOKEN_PREFIX.personal}seed_nnJhjCNq0wqAOppzFvBDmQ`;
const WS = '019a0000-0000-7000-8000-0000000000a1';
const SAM = '019a0000-0000-7000-8000-000000000002';
const FOLDER = '019a0000-0000-7000-8000-0000000000f1';
const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let failures = 0;
function ok(cond: unknown, what: string) {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

async function call(method: string, path: string, opts: { token?: string | null; body?: unknown; raw?: Uint8Array; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  const token = opts.token === undefined ? PAT : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.raw) {
    body = opts.raw as Uint8Array<ArrayBuffer>;
    headers['content-type'] ??= 'application/octet-stream';
  }
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const r = await fetch(S + path, { method, headers, body, redirect: 'manual' });
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer());
  return { status: r.status, data: data as any, headers: r.headers };
}

function split(b: Uint8Array, n: number): Uint8Array[] {
  const size = Math.ceil(b.length / n);
  return Array.from({ length: n }, (_, i) => b.subarray(i * size, Math.min(b.length, (i + 1) * size)));
}

async function create(kind: string, extra: Record<string, unknown> = {}, token: string | null = PAT) {
  const clientId = randomUUID();
  const r = await call('POST', '/api/v1/recordings', {
    token,
    body: { clientId, kind, workspaceId: WS, page: { url: 'http://localhost:5173/checkout', title: 'Checkout - Lab shop' }, startedAt: Date.now(), ...extra },
  });
  return { ...r, clientId };
}

async function put(id: string, stream: string, seq: number, b: Uint8Array, headers: Record<string, string> = {}, token: string | null = PAT) {
  return call('PUT', `/api/v1/recordings/${id}/streams/${stream}/chunks/${seq}`, { raw: b, token, headers: { 'x-sha256': sha(b), ...headers } });
}

async function uploadStream(id: string, stream: string, b: Uint8Array, n: number, headers: Record<string, string> = {}, parts = split(b, n)) {
  for (let i = 0; i < parts.length; i++) await put(id, stream, i, parts[i]!, headers);
  return call('POST', `/api/v1/recordings/${id}/streams/${stream}/complete`, { body: { lastSeq: parts.length - 1, totalBytes: b.length } });
}

/** Wait for the status SSE stream to say ready (or failed). */
async function waitReady(id: string, timeoutMs = 120_000): Promise<string> {
  const r = await fetch(`${S}/api/v1/recordings/${id}/status`, { headers: { authorization: `Bearer ${PAT}` }, signal: AbortSignal.timeout(timeoutMs) });
  const reader = r.body!.getReader();
  let buf = '';
  let last = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return last;
    buf += new TextDecoder().decode(value);
    for (const m of buf.matchAll(/data: (\{.*\})/g)) last = JSON.parse(m[1]!).status;
    if (last === 'ready' || last === 'failed') {
      await reader.cancel();
      return last;
    }
  }
}

function eventsNdjsonGz(events: CaptureEvent[]) {
  return gzipSync(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function shiftEvents(startedAt: number): CaptureEvent[] {
  return tabVideoEvents(startedAt);
}

function probeDuration(b: Uint8Array): number {
  const dir = mkdtempSync(join(tmpdir(), 'tb-check-'));
  const p = join(dir, 'v.webm');
  writeFileSync(p, b);
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim();
  return Number(out) * 1000;
}

async function samToken() {
  const tok = `${TOKEN_PREFIX.personal}check_sam_${randomUUID().slice(0, 8)}`;
  await db.insert(t.apiToken).values({ userId: SAM, kind: 'personal', name: 'check-server-core', tokenHash: hashToken(tok) });
  return tok;
}

// ---------- sections ----------

const sections: Record<string, () => Promise<void>> = {
  async upload() {
    console.log('X-01 upload: 3-chunk streams, a retried chunk, a conflicting chunk, resume list, finalize');
    const c = await create('video');
    ok(c.status === 201 && c.data.shareUrl?.includes('/s/'), `create 201 with a share URL (${c.status})`);
    const again = await call('POST', '/api/v1/recordings', {
      body: { clientId: c.clientId, kind: 'video', workspaceId: WS, page: { url: 'http://localhost:5173/', title: '' }, startedAt: Date.now() },
    });
    ok(again.status === 200 && again.data.id === c.data.id, 'create again with the same clientId: 200, same id');
    const id = c.data.id as string;
    const startedAt = Date.now() - 9000;

    const video = fixture('tab-video.webm');
    const parts = split(video, 3);
    ok((await put(id, 'video', 0, parts[0]!)).status === 201, 'chunk 0: 201');
    ok((await put(id, 'video', 2, parts[2]!)).status === 201, 'chunk 2 before 1: 201');
    const list1 = await call('GET', `/api/v1/recordings/${id}/streams/video/chunks`);
    ok(JSON.stringify(list1.data.chunks.map((x: { seq: number }) => x.seq)) === '[0,2]', 'list shows seqs 0 and 2, so the client resends 1');
    const early = await call('POST', `/api/v1/recordings/${id}/streams/video/complete`, { body: { lastSeq: 2, totalBytes: video.length } });
    ok(early.status === 409 && early.data.error === 'stream_incomplete' && early.data.missing?.[0] === 1, 'complete with a gap: 409 stream_incomplete, missing [1]');
    ok((await put(id, 'video', 1, parts[1]!)).status === 201, 'chunk 1: 201');
    const retry = await put(id, 'video', 1, parts[1]!);
    ok(retry.status === 200 && retry.data.stored === 'duplicate', 'chunk 1 retried: 200 duplicate');
    const clash = await put(id, 'video', 1, new Uint8Array([1, 2, 3]));
    ok(clash.status === 409 && clash.data.error === 'hash_mismatch', 'chunk 1 with other bytes: 409 hash_mismatch');
    const bad = await call('PUT', `/api/v1/recordings/${id}/streams/video/chunks/3`, { raw: new Uint8Array([9]), headers: { 'x-sha256': '0'.repeat(64) } });
    ok(bad.status === 409, 'body that does not match x-sha256: 409');
    const done = await call('POST', `/api/v1/recordings/${id}/streams/video/complete`, { body: { lastSeq: 2, totalBytes: video.length } });
    ok(done.status === 200 && done.data.completed === true, 'complete: 200');

    // a binary stream served back chunk by chunk: rrweb (reassembles byte-identical)
    const rr = Buffer.from(Array.from({ length: 50_000 }, (_, i) => (i * 7919) % 251));
    await uploadStream(id, 'rrweb', rr, 3, { 'content-encoding': 'gzip' });
    const events = shiftEvents(startedAt);
    // events: NDJSON gzipped per chunk, as the extension sends it
    const evParts = [events.slice(0, 10), events.slice(10, 20), events.slice(20)].map(eventsNdjsonGz);
    const evAll = Buffer.concat(evParts);
    const ev = await uploadStream(id, 'events', evAll, 3, { 'content-type': 'application/x-ndjson', 'content-encoding': 'gzip' }, evParts);
    ok(ev.status === 200, 'events stream complete');

    const before = await call('GET', `/api/v1/share/${c.data.shareUrl.split('/s/')[1]}`, { token: null });
    ok(before.status === 404, 'before finalize the share link resolves to 404 (J-189)');

    const t0 = performance.now();
    const fin = await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Upload check', description: 'from check-server-core', durationMs: 8000 } });
    ok(fin.status === 200 && fin.data.shareUrl === c.data.shareUrl && fin.data.status === 'processing', `finalize: 200 with the same share URL in ${Math.round(performance.now() - t0)} ms`);
    const fin2 = await call('POST', `/api/v1/recordings/${id}/finalize`, { body: {} });
    ok(fin2.status === 409 && fin2.data.error === 'already_finalized', 'finalize twice: 409 already_finalized');
    const st = await waitReady(id);
    ok(st === 'ready', `status SSE reaches ready (${st})`);

    const parts3 = [];
    for (let i = 0; i < 3; i++) parts3.push((await call('GET', `/api/v1/recordings/${id}/media/rrweb-${String(i).padStart(3, '0')}`)).data as Uint8Array);
    ok(Buffer.compare(Buffer.concat(parts3), rr) === 0, 'rrweb stream reassembles byte-identical from its 3 chunks');
    const v = await call('GET', `/api/v1/recordings/${id}/media/video`);
    const dur = probeDuration(v.data);
    ok(v.status === 200 && Math.abs(dur - 8008) < 200, `video.webm is the joined stream with a duration (${dur} ms)`);
    const late = await put(id, 'video', 3, new Uint8Array([1]));
    ok(late.status === 409 && late.data.error === 'already_finalized', 'chunk after ready: 409 already_finalized');
    const evs = await call('GET', `/api/v1/recordings/${id}/media/events`);
    const merged = JSON.parse(gunzipSync(evs.data).toString()) as CaptureEvent[];
    ok(merged.length === events.length, `events.json.gz holds all ${events.length} events`);
    const [row] = await db.select().from(t.recording).where(eq(t.recording.id, id));
    const idx = row?.eventIndex as { network: { failed: number; pending: number }; markers: unknown[] } | null;
    ok(idx && idx.network.failed >= 1 && idx.network.pending >= 1 && idx.markers.length > 0, 'event index has a failed and a pending request and markers');
    ok(row?.thumbKey && (await call('GET', `/api/v1/recordings/${id}/media/thumb`)).status === 200, 'thumb.webp poster frame served');
    const chunkKeys = await listKeys(keys.recording(id) + 'video/');
    ok(chunkKeys.length === 0, 'raw video chunks removed from Garage after finalize');
    (globalThis as any).__uploaded = { id, shareUrl: c.data.shareUrl };
  },

  async share() {
    console.log('X-03 share tokens: signed out, headers, Range, revoke');
    const c = await create('video');
    const id = c.data.id;
    await uploadStream(id, 'video', fixture('tab-video.webm'), 2);
    await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Share check' } });
    await waitReady(id);
    const token = c.data.shareUrl.split('/s/')[1] as string;
    ok(/^[A-Za-z0-9_-]{22}$/.test(token), 'token is 22 base64url chars (128 bits)');
    const res = await call('GET', `/api/v1/share/${token}`, { token: null });
    ok(res.status === 200 && res.data.recordingId === id && res.data.devtools === true, 'resolve signed out: 200');
    const page = await fetch(`${S}/s/${token}`);
    ok(page.headers.get('referrer-policy') === 'no-referrer' && page.headers.get('x-robots-tag')?.includes('noindex'), '/s/<token> sends no-referrer and noindex');
    const range = await call('GET', `/s/${token}/media/video`, { token: null, headers: { range: 'bytes=0-1023' } });
    ok(range.status === 206 && range.headers.get('content-range')?.startsWith('bytes 0-1023/') && range.data.length === 1024, 'Range request through the share proxy: 206 with 1024 bytes');
    const full = await call('GET', `/s/${token}/media/video`, { token: null, headers: { 'x-toolbar-share': token } });
    ok(full.status === 200 && full.headers.get('accept-ranges') === 'bytes', 'full GET: 200, accept-ranges bytes');
    const viaHeader = await call('GET', `/api/v1/recordings/${id}/media/thumb`, { token: null, headers: { 'x-toolbar-share': token } });
    ok(viaHeader.status === 200, 'member media route with x-toolbar-share header works signed out');
    const settings = await call('GET', `/api/v1/recordings/${id}/share`);
    ok(settings.status === 200 && settings.data.link.devtools && !settings.data.contentOnlyLink.devtools, 'share settings: default link and content-only link');
    const co = settings.data.contentOnlyLink.url.split('/s/')[1];
    ok((await call('GET', `/s/${co}/media/events`, { token: null })).status === 403, 'content-only link refuses dev tools media (J-118)');
    ok((await call('GET', `/s/${co}/media/video`, { token: null })).status === 200, 'content-only link serves the video');
    const extra = await call('POST', `/api/v1/recordings/${id}/share-links`, { body: { devtools: true, expiresInDays: 14 } });
    ok(extra.status === 201 && extra.data.expiresAt, 'mint another link with a 14-day expiry');
    const linkId = settings.data.link.id;
    const rv = await call('DELETE', `/api/v1/share-links/${linkId}`);
    ok(rv.status === 200, 'revoke the default link');
    ok((await call('GET', `/api/v1/share/${token}`, { token: null })).status === 404, 'revoked token: resolve 404');
    ok((await call('GET', `/s/${token}/media/video`, { token: null })).status === 404, 'revoked token: media 404');
    ok((await call('GET', `/api/v1/share/AAAAAAAAAAAAAAAAAAAAAA`, { token: null })).status === 404, 'unknown token: 404');
    // expired
    const exp = await call('POST', `/api/v1/recordings/${id}/share-links`, { body: { devtools: true, expiresInDays: 1 } });
    await db.update(t.shareLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(t.shareLink.id, exp.data.id));
    ok((await call('GET', `/api/v1/share/${exp.data.url.split('/s/')[1]}`, { token: null })).status === 404, 'expired token: 404');
  },

  async access() {
    console.log('J-119 per-capture general access');
    const c = await create('screenshot');
    const id = c.data.id;
    const png = fixture('screenshot.png');
    const form = new FormData();
    form.set('kind', 'screenshot');
    form.set('recordingId', id);
    form.set('file', new Blob([png], { type: 'image/png' }), 'shot.png');
    const up = await fetch(`${S}/api/v1/assets`, { method: 'POST', headers: { authorization: `Bearer ${PAT}` }, body: form });
    const a = await up.json();
    ok(up.status === 201 && a.width === 720 && a.height === 300, `asset upload: 201 with size from the PNG header (${a.width}x${a.height})`);
    await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Access check', screenshotAssetId: a.id } });
    ok((await waitReady(id)) === 'ready', 'screenshot capture ready');
    ok((await call('GET', `/api/v1/recordings/${id}/media/thumb`)).status === 200, 'screenshot thumbnail made');
    const token = c.data.shareUrl.split('/s/')[1];
    ok((await call('PATCH', `/api/v1/recordings/${id}/share`, { body: { access: 'workspace' } })).data.access === 'workspace', 'set access to workspace');
    ok((await call('GET', `/api/v1/share/${token}`, { token: null })).status === 401, 'signed out: 401 (sign-in page)');
    ok((await call('GET', `/s/${token}/media/screenshot`, { token: null })).status === 401, 'signed out media: 401');
    ok((await call('GET', `/api/v1/share/${token}`)).status === 200, 'member: 200');
    ok((await call('GET', `/api/v1/recordings/${id}/media/screenshot`, { token: null, headers: { 'x-toolbar-share': token } })).status === 401, 'share header on a workspace capture: 401');
    await call('PATCH', `/api/v1/recordings/${id}/share`, { body: { access: 'anyone' } });
    ok((await call('GET', `/api/v1/share/${token}`, { token: null })).status === 200, 'back to anyone: signed out 200');
  },

  async trim() {
    console.log('J-227 trim cuts video, logs and events');
    const startedAt = Date.now() - 9000;
    const c = await create('video', { startedAt });
    const id = c.data.id;
    const events = shiftEvents(startedAt);
    await uploadStream(id, 'video', fixture('tab-video.webm'), 3);
    await uploadStream(id, 'events', eventsNdjsonGz(events), 1, { 'content-encoding': 'gzip' });
    // rrweb: Meta + FullSnapshot at the start, more pairs at 2.5 s and 4.5 s, an increment every 250 ms
    const rr: { type: number; timestamp: number; data: unknown }[] = [];
    for (const at of [50, 2500, 4500]) rr.push({ type: 4, timestamp: startedAt + at, data: { href: 'http://localhost:5173/', width: 1280, height: 720 } }, { type: 2, timestamp: startedAt + at + 1, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 }, at } });
    for (let ms = 100; ms < 9000; ms += 250) rr.push({ type: 3, timestamp: startedAt + ms, data: { source: 1, positions: [{ x: ms % 700, y: 100, id: 1, timeOffset: 0 }] } });
    rr.sort((a, b) => a.timestamp - b.timestamp);
    const rrParts = [rr.slice(0, 15), rr.slice(15)].map((p) => gzipSync(p.map((e) => JSON.stringify(e)).join('\n') + '\n'));
    for (let i = 0; i < rrParts.length; i++) await put(id, 'rrweb', i, rrParts[i]!, { 'content-encoding': 'gzip' });
    await call('POST', `/api/v1/recordings/${id}/streams/rrweb/complete`, { body: { lastSeq: 1, totalBytes: rrParts[0]!.length + rrParts[1]!.length } });
    const fin = await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Trim check', trim: { startMs: 3000, endMs: 6000 } } });
    ok(fin.status === 200, 'finalize with trim 3 s to 6 s (the 500 is at 2.9 s)');
    const proc = await call('GET', `/api/v1/recordings/${id}/media/video`);
    ok(proc.status === 404, 'while the trim job runs the video is not served yet (processing)');
    ok((await waitReady(id)) === 'ready', 'trimmed capture ready');
    const v = await call('GET', `/api/v1/recordings/${id}/media/video`);
    const dur = probeDuration(v.data);
    ok(Math.abs(dur - 3000) < 150, `trimmed video is 3 s (${dur} ms)`);
    const evs = JSON.parse(gunzipSync((await call('GET', `/api/v1/recordings/${id}/media/events`)).data).toString()) as CaptureEvent[];
    const [row] = await db.select().from(t.recording).where(eq(t.recording.id, id));
    const vo = row!.videoOffsetMs;
    const lo = startedAt + vo + 3000;
    const hi = startedAt + vo + 6000;
    ok(evs.every((e) => e.kind === 'env' || (e.t >= lo && e.t <= hi)), `only events inside the kept range remain (${evs.length} of ${events.length})`);
    const dropped500 = events.some((e) => e.kind === 'net.res' && e.data.status === 500 && (e.t < lo || e.t > hi));
    const kept500 = evs.some((e) => e.kind === 'net.res' && e.data.status === 500);
    ok(dropped500 && !kept500, 'the 500 outside the kept range is gone from the events');
    const idx = row!.eventIndex as { markers: { kind: string; status: number | null }[] } | null;
    ok(!!idx && !idx.markers.some((m) => m.status === 500), 'no 500 marker on the timeline');
    // the capture detail route is the viewer's; the media names are rrweb-000.. per stored chunk
    const rrRows = await db.select({ seq: t.recordingChunk.seq }).from(t.recordingChunk).where(and(eq(t.recordingChunk.recordingId, id), eq(t.recordingChunk.stream, 'rrweb')));
    const rrUrls = rrRows.map((r) => `${S}/api/v1/recordings/${id}/media/rrweb-${String(r.seq).padStart(3, '0')}`);
    const rrOut: { type: number; timestamp: number; data: { at?: number } }[] = [];
    for (const u of rrUrls) {
      const r = await fetch(u, { headers: { authorization: `Bearer ${PAT}` } });
      rrOut.push(...gunzipSync(new Uint8Array(await r.arrayBuffer())).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    }
    ok(rrUrls.length >= 1 && rrOut.length > 0 && rrOut.every((e) => e.timestamp >= lo && e.timestamp <= hi), `rrweb cut to the kept range (${rrOut.length} of ${rr.length} events in ${rrUrls.length} chunk(s))`);
    ok(rrOut[0]?.type === 4 && rrOut[1]?.type === 2 && rrOut[1]?.data.at === 2500 && rrOut[0]?.timestamp === lo, 'rrweb starts with the last Meta and FullSnapshot before the cut, moved to the trim start');
    ok(rrOut.filter((e) => e.type === 2).length === 2, 'the snapshot taken inside the range is kept');
    ok((await listKeys(keys.recording(id))).filter((k) => k.includes('/rrweb/')).length === 0, 'the untrimmed rrweb chunks are gone from Garage');
    ok(row!.durationMs !== null && Math.abs(row!.durationMs - 3000) < 150, `durationMs matches the draft label (${row!.durationMs})`);
  },

  async draft() {
    console.log('J-189 nothing leaves before create; discard deletes uploaded chunks');
    const c = await create('video');
    const id = c.data.id;
    await uploadStream(id, 'video', fixture('tab-video.webm'), 3);
    const token = c.data.shareUrl.split('/s/')[1];
    ok((await call('GET', `/api/v1/share/${token}`, { token: null })).status === 404, 'share URL of a draft: 404');
    ok((await call('GET', `/api/v1/recordings/${id}/media/video`, { token: await samToken() })).status === 404, 'another member cannot reach the draft');
    ok((await listKeys(keys.recording(id))).length === 3, 'three chunks in Garage');
    const del = await call('DELETE', `/api/v1/recordings/${id}`);
    ok(del.status === 200 && del.data.purged === true, 'discard: 200 purged');
    ok((await listKeys(keys.recording(id))).length === 0, 'Garage prefix empty after discard');
    const [row] = await db.select().from(t.recording).where(eq(t.recording.id, id));
    ok(!row, 'draft row gone');
  },

  async delete() {
    console.log('J-191 deletion: gone at once, media 404, purge empties the prefix');
    const c = await create('video');
    const id = c.data.id;
    await uploadStream(id, 'video', fixture('tab-video.webm'), 2);
    await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Delete check' } });
    await waitReady(id);
    const token = c.data.shareUrl.split('/s/')[1];
    ok((await call('GET', `/s/${token}/media/video`, { token: null })).status === 200, 'media served before delete');
    const sam = await samToken();
    ok((await call('DELETE', `/api/v1/recordings/${id}`, { token: sam })).status === 403, 'a creator cannot delete a capture of someone else');
    const del = await call('DELETE', `/api/v1/recordings/${id}`);
    ok(del.status === 200 && del.data.purged === false, 'delete: 200');
    ok((await call('GET', `/api/v1/recordings/${id}/media/video`)).status === 404, 'member media URL: 404 at once');
    ok((await call('GET', `/s/${token}/media/video`, { token: null })).status === 404, 'share media URL: 404 at once');
    ok((await call('GET', `/api/v1/share/${token}`, { token: null })).status === 404, 'share link: 404');
    let left = -1;
    for (let i = 0; i < 30; i++) {
      left = (await listKeys(keys.recording(id))).length;
      if (left === 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    ok(left === 0, 'purge job removed the Garage prefix');
  },

  async private() {
    console.log('J-237 private folders and private captures');
    const sam = await samToken();
    const c = await create('video', { folderId: FOLDER });
    const id = c.data.id;
    await uploadStream(id, 'video', fixture('tab-video.webm'), 1);
    await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Private check' } });
    await waitReady(id);
    ok((await call('GET', `/api/v1/recordings/${id}/media/thumb`, { token: sam })).status === 200, 'open folder: Sam sees the capture');
    await db.insert(t.folderAccess).values({ folderId: FOLDER, private: true }).onConflictDoUpdate({ target: t.folderAccess.folderId, set: { private: true } });
    ok((await call('GET', `/api/v1/recordings/${id}/media/thumb`, { token: sam })).status === 404, 'private folder: Sam (not invited) gets 404 by URL');
    ok((await call('GET', `/api/v1/recordings/${id}/media/thumb`)).status === 200, 'private folder: Dana (admin, folder creator) still sees it');
    const listed = async (uid: string, seat: 'creator' | 'admin') =>
      (await db.select({ id: t.recording.id }).from(t.recording).where(and(eq(t.recording.id, id), visibleCapturesWhere(uid, seat)))).length === 1;
    const folderListed = async (uid: string) =>
      (await db.select({ id: t.folder.id }).from(t.folder).where(and(eq(t.folder.id, FOLDER), visibleFoldersWhere(uid, 'creator')))).length === 1;
    ok(!(await listed(SAM, 'creator')) && !(await folderListed(SAM)), 'list and search filter (visibleCapturesWhere, visibleFoldersWhere) hide it from Sam');
    ok(await listed(SAM, 'admin'), 'the same filter shows it to an admin');
    await db.insert(t.folderMember).values({ folderId: FOLDER, userId: SAM, role: 'viewer' });
    ok((await call('GET', `/api/v1/recordings/${id}/media/thumb`, { token: sam })).status === 200, 'invited to the folder: Sam sees it');
    await db.delete(t.folderMember).where(eq(t.folderMember.folderId, FOLDER));
    await db.update(t.folderAccess).set({ private: false }).where(eq(t.folderAccess.folderId, FOLDER));
    await db.update(t.recording).set({ private: true }).where(eq(t.recording.id, id));
    // Dana is admin; make a capture of Sam's private and check Dana-as-admin still sees, then a third view is covered by unit tests
    const own = await create('video', {}, sam);
    await uploadStream2(own.data.id, sam);
    await call('POST', `/api/v1/recordings/${own.data.id}/finalize`, { token: sam, body: { title: 'Sam private' } });
    await waitReady(own.data.id);
    await db.update(t.recording).set({ private: true }).where(eq(t.recording.id, own.data.id));
    ok((await call('GET', `/api/v1/recordings/${own.data.id}/media/thumb`, { token: sam })).status === 200, 'private capture: its author sees it');
    ok((await call('GET', `/api/v1/recordings/${id}/media/thumb`, { token: sam })).status === 404, "private capture of Dana's: Sam gets 404");
  },

  async renditions() {
    console.log('J-054 tab video file with renditions');
    const id = (globalThis as any).__uploaded?.id ?? (await quickVideo());
    let list: { height: number }[] = [];
    for (let i = 0; i < 90; i++) {
      const [row] = await db.select().from(t.recording).where(eq(t.recording.id, id));
      list = (row?.renditions as { height: number }[] | null) ?? [];
      if (list.length >= 3) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    ok(list.map((r) => r.height).join(',') === '480,360,240', `renditions below the 720p original: ${list.map((r) => r.height).join(',')}`);
    const r = await call('GET', `/api/v1/recordings/${id}/media/video-360`, { headers: { range: 'bytes=0-99' } });
    ok(r.status === 206, 'video-360 served with Range');
    const dl = await call('GET', `/api/v1/recordings/${id}/media/video?download=1`);
    ok(dl.headers.get('content-disposition')?.startsWith('attachment;'), 'download=1 sends an attachment (J-098)');
    // a 1080p source gets the whole ladder, 720p down to 240p
    const dir = mkdtempSync(join(tmpdir(), 'tb-hd-'));
    const hd = join(dir, 'hd.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '6', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M', hd]);
    const c = await create('video');
    await uploadStream(c.data.id, 'video', readFileSync(hd), 2);
    await call('POST', `/api/v1/recordings/${c.data.id}/finalize`, { body: { title: 'HD' } });
    await waitReady(c.data.id);
    for (let i = 0; i < 120; i++) {
      const [row] = await db.select().from(t.recording).where(eq(t.recording.id, c.data.id));
      list = (row?.renditions as { height: number }[] | null) ?? [];
      if (list.length >= 4) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    ok(list.map((r) => r.height).join(',') === '720,480,360,240', `1080p original: renditions ${list.map((r) => r.height).join(',')}`);
    ok((await call('GET', `/api/v1/recordings/${c.data.id}/media/video-720`, { headers: { range: 'bytes=0-99' } })).status === 206, 'video-720 served with Range');
    // the viewer's quality menu reads these from the capture detail, for members and share links
    const labels = (d: any) => (d?.media?.video?.renditions ?? []).map((r: { label: string }) => r.label).join(',');
    const member = (await call('GET', `/api/v1/recordings/${c.data.id}`)).data;
    ok(labels(member) === 'Original,720p,480p,360p,240p', `capture detail lists the renditions: ${labels(member)}`);
    const tok = c.data.shareUrl.split('/s/')[1] as string;
    const shared = (await call('GET', `/api/v1/recordings/${c.data.id}`, { token: null, headers: { 'x-toolbar-share': tok } })).data;
    const r240 = (shared?.media?.video?.renditions ?? []).find((x: { label: string }) => x.label === '240p');
    ok(labels(shared) === labels(member) && r240?.url.endsWith(`/s/${tok}/media/video-240`), `share viewer gets the same menu on the share proxy: ${labels(shared)}`);
    const via = await call('GET', new URL(r240?.url ?? '/none', S).pathname, { token: null, headers: { range: 'bytes=0-99' } });
    ok(via.status === 206 && via.headers.get('content-type') === 'video/webm', 'the 240p menu entry plays through the share proxy');
  },

  async transcript() {
    console.log('J-074 voice transcript from whisper.cpp; no voice, no job');
    const c = await create('video');
    const id = c.data.id;
    await uploadStream(id, 'video', fixture('tab-video.webm'), 2);
    await uploadStream(id, 'voice', fixture('voice.webm'), 2);
    await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Voice check' } });
    await waitReady(id);
    let tr: any = null;
    const t0 = Date.now();
    for (let i = 0; i < 120; i++) {
      tr = (await call('GET', `/api/v1/recordings/${id}/transcript`)).data;
      if (tr.status === 'done' || tr.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    ok(tr?.status === 'done' && tr.vtt.startsWith('WEBVTT') && tr.cues.length > 0, `transcript done in ${Math.round((Date.now() - t0) / 1000)} s with ${tr?.cues?.length} cues`);
    ok(/submit|order|checkout|sync/i.test(tr?.vtt ?? ''), `transcript text matches the speech: ${JSON.stringify(tr?.cues?.[0]?.text)}`);
    const vtt = await fetch(`${S}/api/v1/recordings/${id}/media/transcript`, { headers: { authorization: `Bearer ${PAT}` } });
    ok(vtt.headers.get('content-type')?.startsWith('text/vtt'), 'transcript served as text/vtt for <track> captions (J-236)');
    const none = (globalThis as any).__uploaded?.id ?? (await quickVideo());
    const n = (await call('GET', `/api/v1/recordings/${none}/transcript`)).data;
    ok(n.status === 'none' && n.reason === 'no-voice', 'capture without a voice stream: status none, reason no-voice');
    const jobs = await db.select().from(t.job).where(eq(t.job.type, 'transcribe'));
    ok(!jobs.some((j) => (j.payload as { recordingId?: string }).recordingId === none), 'no transcribe job for the capture without voice');
  },

  async chapters() {
    console.log('J-075 AI chapters (needs AI_PROVIDER=openai-compatible on the server; espeak-ng and ffmpeg here)');
    const dir = mkdtempSync(join(tmpdir(), 'tb-chap-'));
    const vid = join(dir, 'v.webm');
    const voice = join(dir, 'n.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15', '-t', '60', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', vid]);
    const text =
      'First I open the checkout page and look at the cart. Now I press the submit order button. The spinner stops and no message appears. ' +
      'Next I try the sync button at the top. It never finishes. Finally I open the details form, type my name and email, and press send. Nothing happens.';
    execFileSync('espeak-ng', ['-s', '120', '-w', join(dir, 'n.wav'), text]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', join(dir, 'n.wav'), '-c:a', 'libopus', '-b:a', '32k', voice]);
    const c = await create('video');
    const id = c.data.id;
    await uploadStream(id, 'video', readFileSync(vid), 2);
    await uploadStream(id, 'voice', readFileSync(voice), 1);
    await call('POST', `/api/v1/recordings/${id}/finalize`, { body: { title: 'Chapters check' } });
    await waitReady(id);
    let chapters: { title: string; startMs: number }[] = [];
    for (let i = 0; i < 180; i++) {
      const [row] = await db.select().from(t.recording).where(eq(t.recording.id, id));
      chapters = (row?.chapters as typeof chapters | null) ?? [];
      if (chapters.length) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    ok(chapters.length >= 2 && chapters.length <= 4 && chapters[0]!.startMs === 0, `2 to 4 chapters with start times: ${chapters.map((c) => `${c.startMs / 1000}s ${c.title}`).join(' | ')}`);
  },
};

async function uploadStream2(id: string, token: string) {
  const b = fixture('tab-video.webm');
  await put(id, 'video', 0, b, {}, token);
  await call('POST', `/api/v1/recordings/${id}/streams/video/complete`, { token, body: { lastSeq: 0, totalBytes: b.length } });
}

async function quickVideo() {
  const c = await create('video');
  await uploadStream(c.data.id, 'video', fixture('tab-video.webm'), 1);
  await call('POST', `/api/v1/recordings/${c.data.id}/finalize`, { body: { title: 'Quick' } });
  await waitReady(c.data.id);
  return c.data.id as string;
}

const want = process.argv.slice(2);
try {
  for (const [name, fn] of Object.entries(sections)) {
    if (want.length ? !want.includes(name) : name === 'chapters') continue;
    try {
      await fn();
    } catch (e) {
      failures++;
      console.log(`  FAIL ${name} threw: ${(e as Error).stack}`);
    }
  }
} finally {
  await sqlClient.end();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
