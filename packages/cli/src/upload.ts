// Make a capture through the server's upload API (architecture s5): create, chunked stream
// uploads with sha256, assets, complete, finalize. Used by `nib create` and `nib record`.
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { CaptureEvent, EnvInfo } from '@toolbar/shared/events';
import { CliError, restJson, type Client } from './client.ts';

export const CHUNK_BYTES = 8 * 1024 * 1024;

/** UUIDv7 (RFC 9562): 48-bit ms time, then random bits. */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function workspaceOf(c: Client, asked?: string): Promise<string> {
  if (asked) return asked;
  const me = await restJson<{ activeWorkspaceId?: string | null }>(await c.rest('GET', '/api/v1/me'));
  if (me.activeWorkspaceId) return me.activeWorkspaceId;
  const ws = await restJson<{ items?: { id: string }[] } | { id: string }[]>(await c.rest('GET', '/api/v1/workspaces'));
  const list = Array.isArray(ws) ? ws : (ws.items ?? []);
  if (!list[0]) throw new CliError('You are not a member of any workspace.');
  return list[0].id;
}

export interface NewCapture {
  kind: 'screenshot' | 'video';
  workspaceId: string;
  folderId?: string;
  page: { url: string; title?: string };
  startedAt: number;
  env?: EnvInfo;
  durationMs?: number;
}

export async function createCapture(c: Client, n: NewCapture): Promise<{ id: string; shareUrl: string }> {
  return restJson(
    await c.rest('POST', '/api/v1/recordings', {
      clientId: uuidv7(),
      kind: n.kind,
      workspaceId: n.workspaceId,
      ...(n.folderId ? { folderId: n.folderId } : {}),
      page: { url: n.page.url, title: n.page.title ?? '' },
      startedAt: n.startedAt,
      ...(n.env ? { env: n.env } : {}),
      source: 'cli',
      ...(n.durationMs ? { durationMs: Math.round(n.durationMs) } : {}),
    }),
  );
}

async function putChunk(c: Client, id: string, stream: string, seq: number, body: Uint8Array, headers: Record<string, string>) {
  const sha = createHash('sha256').update(body).digest('hex');
  for (let attempt = 0; ; attempt++) {
    const res = await c.rest('PUT', `/api/v1/recordings/${id}/streams/${stream}/chunks/${seq}`, undefined, {
      raw: new Uint8Array(body),
      headers: { 'x-sha256': sha, ...headers },
    });
    if (res.ok) return;
    if (attempt >= 3 || res.status < 500) await restJson(res);
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
}

/** Upload one stream in 8 MiB chunks and mark it complete. */
export async function uploadStream(c: Client, id: string, stream: 'video' | 'events', data: Uint8Array, contentType: string, extra: Record<string, string> = {}) {
  let seq = 0;
  for (let off = 0; off < data.length || seq === 0; off += CHUNK_BYTES) {
    await putChunk(c, id, stream, seq, data.subarray(off, off + CHUNK_BYTES), { 'content-type': contentType, ...extra });
    seq++;
    if (data.length === 0) break;
  }
  await restJson(await c.rest('POST', `/api/v1/recordings/${id}/streams/${stream}/complete`, { lastSeq: seq - 1, totalBytes: data.length }));
}

/** Events as one gzipped NDJSON chunk per 8 MiB of compressed data. */
export async function uploadEvents(c: Client, id: string, events: CaptureEvent[]) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const lines = sorted.map((e) => JSON.stringify(e));
  const parts: string[][] = [[]];
  let size = 0;
  for (const l of lines) {
    if (size + l.length > 24 * 1024 * 1024 && parts.at(-1)!.length) {
      parts.push([]);
      size = 0;
    }
    parts.at(-1)!.push(l);
    size += l.length + 1;
  }
  let seq = 0;
  let total = 0;
  for (const p of parts) {
    const body = gzipSync(p.join('\n') + '\n');
    total += body.length;
    await putChunk(c, id, 'events', seq++, body, { 'content-type': 'application/x-ndjson', 'content-encoding': 'gzip' });
  }
  await restJson(await c.rest('POST', `/api/v1/recordings/${id}/streams/events/complete`, { lastSeq: seq - 1, totalBytes: total }));
}

export async function uploadAsset(c: Client, id: string, kind: 'screenshot' | 'crop' | 'thumb', bytes: Uint8Array, contentType: string, size?: { width: number; height: number }) {
  const form = new FormData();
  form.set('kind', kind);
  form.set('recordingId', id);
  if (size) {
    form.set('width', String(size.width));
    form.set('height', String(size.height));
  }
  form.set('file', new Blob([new Uint8Array(bytes)], { type: contentType }), `${kind}.${contentType.split('/')[1] ?? 'bin'}`);
  return restJson<{ id: string }>(await c.rest('POST', '/api/v1/assets', undefined, { raw: form }));
}

export async function finalize(c: Client, id: string, body: Record<string, unknown>) {
  return restJson<{ id: string; shareUrl: string; status: string }>(await c.rest('POST', `/api/v1/recordings/${id}/finalize`, body));
}
