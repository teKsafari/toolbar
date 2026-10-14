// In-memory stand-in for the server-core upload API (packages/shared/src/api/captures.ts), so
// the capture area can prove its uploader before server-core lands. Paths come from the route
// table; bodies are checked with the contract's zod schemas. Not a product server.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { ROUTES, matchPath, createCaptureBodySchema, finalizeCaptureBodySchema } from '@toolbar/shared/api';
import { completeStreamSchema } from '@toolbar/shared';

export interface MockChunk {
  seq: number;
  body: Buffer;
  sha256: string;
  encoding: string | null;
  contentType: string;
  t0: number;
  t1: number;
  at: number;
}

export interface MockCapture {
  id: string;
  clientId: string;
  body: Record<string, unknown>;
  streams: Record<string, Map<number, MockChunk>>;
  completed: Record<string, { lastSeq: number; totalBytes: number }>;
  finalized: Record<string, unknown> | null;
  deleted: boolean;
  createdAt: number;
}

export interface MockLogEntry {
  at: number;
  method: string;
  path: string;
  route: string | null;
  status: number;
  auth: string | null;
}

export interface MockServer {
  url: string;
  captures: Map<string, MockCapture>;
  assets: Map<string, { kind: string; recordingId?: string; bytes: number; body: Buffer }>;
  log: MockLogEntry[];
  /** Make the next n chunk PUTs fail with 503 (retry tests). */
  failNextPuts(n: number): void;
  /** Decoded NDJSON lines of a stream, in seq order. */
  ndjson(id: string, stream: string): unknown[];
  /** Concatenated bytes of a binary stream, in seq order. */
  bytes(id: string, stream: string): Buffer;
  reset(): void;
  close(): Promise<void>;
}

const TOKEN = 'tb_dev_e2e_capture';
export const MOCK_TOKEN = TOKEN;

export async function startMockServer(port: number): Promise<MockServer> {
  const captures = new Map<string, MockCapture>();
  const assets = new Map<string, { kind: string; recordingId?: string; bytes: number; body: Buffer }>();
  const log: MockLogEntry[] = [];
  let failPuts = 0;
  let n = 0;
  const base = `http://localhost:${port}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const send = (status: number, body: unknown) => {
      entry.status = status;
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };
    const entry: MockLogEntry = { at: Date.now(), method: req.method ?? '', path: url.pathname, route: null, status: 0, auth: req.headers.authorization ?? null };
    log.push(entry);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
      return res.end();
    }
    const route = Object.values(ROUTES).find((r) => r.method === req.method && matchPath(r.path, url.pathname));
    if (!route) return send(404, { error: 'not_found' });
    entry.route = route.name;
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
    const p = matchPath(route.path, url.pathname)!;
    const json = () => JSON.parse(raw.toString('utf8') || '{}') as unknown;
    switch (route.name) {
      case 'captures.create': {
        const b = createCaptureBodySchema.safeParse(json());
        if (!b.success) return send(422, { error: 'invalid_body', issues: b.error.issues });
        const existing = [...captures.values()].find((c) => c.clientId === b.data.clientId);
        if (existing) return send(200, { id: existing.id, shareUrl: `${base}/s/${existing.id}` });
        const id = `019a0000-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;
        captures.set(id, { id, clientId: b.data.clientId, body: b.data as Record<string, unknown>, streams: {}, completed: {}, finalized: null, deleted: false, createdAt: Date.now() });
        return send(201, { id, shareUrl: `${base}/s/${id}` });
      }
      case 'captures.putChunk': {
        const c = captures.get(p.id!);
        if (!c || c.deleted) return send(404, { error: 'not_found' });
        if (failPuts > 0) {
          failPuts--;
          return send(503, { error: 'unavailable' });
        }
        const sha = createHash('sha256').update(raw).digest('hex');
        if (req.headers['x-sha256'] !== sha) return send(422, { error: 'invalid_body', message: 'sha256 mismatch' });
        const s = (c.streams[p.stream!] ??= new Map());
        const seq = Number(p.seq);
        const prev = s.get(seq);
        if (prev && prev.sha256 !== sha) return send(409, { error: 'hash_mismatch' });
        if (prev) return send(200, { seq, stored: 'duplicate' });
        s.set(seq, { seq, body: raw, sha256: sha, encoding: (req.headers['content-encoding'] as string) ?? null, contentType: String(req.headers['content-type']), t0: Number(req.headers['x-t0']), t1: Number(req.headers['x-t1']), at: Date.now() });
        return send(201, { seq, stored: 'new' });
      }
      case 'captures.listChunks': {
        const c = captures.get(p.id!);
        if (!c) return send(404, { error: 'not_found' });
        const s = c.streams[p.stream!] ?? new Map();
        const list = [...s.values()].sort((a, b) => a.seq - b.seq).map((x) => ({ seq: x.seq, bytes: x.body.length, sha256: x.sha256 }));
        return send(200, { stream: p.stream, chunks: list, lastSeq: list.length ? list[list.length - 1]!.seq : null, completed: !!c.completed[p.stream!] });
      }
      case 'captures.completeStream': {
        const c = captures.get(p.id!);
        if (!c) return send(404, { error: 'not_found' });
        const b = completeStreamSchema.safeParse(json());
        if (!b.success) return send(422, { error: 'invalid_body' });
        const s = c.streams[p.stream!] ?? new Map();
        const missing: number[] = [];
        for (let i = 0; i <= b.data.lastSeq; i++) if (!s.has(i)) missing.push(i);
        if (missing.length) return send(409, { error: 'stream_incomplete', missing });
        c.completed[p.stream!] = b.data;
        return send(200, { stream: p.stream, completed: true, missing: [] });
      }
      case 'captures.finalize': {
        const c = captures.get(p.id!);
        if (!c) return send(404, { error: 'not_found' });
        const b = finalizeCaptureBodySchema.safeParse(json());
        if (!b.success) return send(422, { error: 'invalid_body', issues: b.error.issues });
        c.finalized = b.data as Record<string, unknown>;
        return send(200, { id: c.id, shareUrl: `${base}/s/${c.id}`, status: 'processing', issue: null, issueError: null });
      }
      case 'captures.uploadAsset': {
        const ct = String(req.headers['content-type'] ?? '');
        const boundary = /boundary=(.+)$/.exec(ct)?.[1];
        if (!boundary) return send(422, { error: 'invalid_body' });
        const fields: Record<string, string> = {};
        let file: Buffer | null = null;
        for (const part of raw.toString('latin1').split(`--${boundary}`)) {
          const m = /name="([^"]+)"(?:; filename="[^"]*")?[\s\S]*?\r\n\r\n([\s\S]*)\r\n$/.exec(part);
          if (!m) continue;
          if (part.includes('filename=')) file = Buffer.from(m[2]!, 'latin1');
          else fields[m[1]!] = m[2]!;
        }
        if (!file) return send(422, { error: 'invalid_body' });
        const id = `019a0000-0000-7000-8000-a${(++n).toString(16).padStart(11, '0')}`;
        assets.set(id, { kind: fields.kind ?? '', recordingId: fields.recordingId, bytes: file.length, body: file });
        return send(201, { id, kind: fields.kind, url: `${base}/a/${id}`, contentType: 'image/png', width: null, height: null, bytes: file.length, name: null });
      }
      case 'captures.delete': {
        const c = captures.get(p.id!);
        if (!c) return send(404, { error: 'not_found' });
        c.deleted = true;
        c.streams = {};
        return send(200, { ok: true, purged: true });
      }
      default:
        return send(501, { error: 'not_implemented', message: route.name });
    }
  });
  await new Promise<void>((r) => server.listen(port, r));
  return {
    url: base,
    captures,
    assets,
    log,
    failNextPuts(k) {
      failPuts = k;
    },
    ndjson(id, stream) {
      const s = captures.get(id)?.streams[stream];
      if (!s) return [];
      const out: unknown[] = [];
      for (const c of [...s.values()].sort((a, b) => a.seq - b.seq)) {
        const text = (c.encoding === 'gzip' ? gunzipSync(c.body) : c.body).toString('utf8');
        for (const l of text.split('\n')) if (l.trim()) out.push(JSON.parse(l));
      }
      return out;
    },
    bytes(id, stream) {
      const s = captures.get(id)?.streams[stream];
      return s ? Buffer.concat([...s.values()].sort((a, b) => a.seq - b.seq).map((c) => c.body)) : Buffer.alloc(0);
    },
    reset() {
      captures.clear();
      assets.clear();
      log.length = 0;
      failPuts = 0;
    },
    close: () =>
      new Promise<void>((r) => {
        // keep-alive sockets would hold close() open past the fixture's teardown timeout
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
