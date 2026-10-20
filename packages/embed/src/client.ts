// HTTP client of the embed (D-211). The page holds no credential: the public project key opens
// the config and create routes, and each capture comes back with its own upload token (tb_upl_)
// for the upload routes. Requests go cross-origin to the server, without cookies, through the
// fetch saved before the capture hooks were installed, so they stay out of the reviewer's network
// log.
//
// Paths are spelled out instead of read from ROUTES so the bundle does not carry zod;
// test/client.test.ts checks the upload ones against the route table.
import { HEADERS, STREAM_CONTENT_TYPES } from '@toolbar/shared/constants';
import type { MaskingPreset } from '@toolbar/shared';
import type { FeedbackItemInput } from '@toolbar/shared/areas/reviewer';

export const EMBED_ROUTES = {
  'embed.config': { method: 'GET', path: '/api/v1/embed/:key/config' },
  'embed.create': { method: 'POST', path: '/api/v1/embed/:key/recordings' },
  'captures.putChunk': { method: 'PUT', path: '/api/v1/recordings/:id/streams/:stream/chunks/:seq' },
  'captures.completeStream': { method: 'POST', path: '/api/v1/recordings/:id/streams/:stream/complete' },
  'captures.finalize': { method: 'POST', path: '/api/v1/recordings/:id/finalize' },
  'captures.uploadAsset': { method: 'POST', path: '/api/v1/assets' },
  'feedback.create': { method: 'POST', path: '/api/v1/recordings/:id/feedback' },
} as const;

type RouteName = keyof typeof EMBED_ROUTES;
export type PageStream = 'events' | 'rrweb';

export class EmbedHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** the server's JSON error body, when it sent one */
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(typeof body?.message === 'string' ? body.message : code);
  }
}

/** GET /api/v1/embed/:key/config */
export interface EmbedConfig {
  project: { id: string; name: string };
  workspaceId: string;
  maskingPreset: MaskingPreset;
  bodyAllowlist: string[];
  traceOpenMs: number;
  brand: { name: string; accent: string | null };
}

/** Who sends: a random id per browser, and the name and email the reviewer gave, if any. */
export interface EmbedReviewer {
  id: string;
  name?: string;
  email?: string;
}

export interface EmbedCreateBody {
  clientId: string;
  kind: 'feedback' | 'replay' | 'trace';
  /** from the config; the server takes the key's own workspace whatever is sent */
  workspaceId: string;
  page: { url: string; title: string };
  startedAt: number;
  env?: unknown;
  source: 'embed';
  durationMs?: number;
  reviewer?: EmbedReviewer;
}

/** A capture made through the key, and the bearer of its upload routes. */
export interface EmbedCapture {
  id: string;
  uploadToken: string;
}

const fill = (path: string, params: Record<string, string | number>) => path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(String(params[k])));

export function createEmbedClient(nativeFetch: typeof fetch, server: string, key: string) {
  const base = server.replace(/\/+$/, '');
  async function call<T>(name: RouteName, params: Record<string, string | number>, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; token?: string; keepalive?: boolean } = {}): Promise<T> {
    const r = EMBED_ROUTES[name];
    const headers: Record<string, string> = { ...init.headers };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    let res: Response;
    try {
      res = await nativeFetch(base + fill(r.path, { key, ...params }), { method: r.method, headers, body, credentials: 'omit', mode: 'cors', keepalive: init.keepalive, cache: 'no-store' });
    } catch {
      throw new EmbedHttpError(0, 'network');
    }
    if (!res.ok) {
      let code = `http_${res.status}`;
      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
        if (typeof json.error === 'string') code = json.error;
      } catch {
        /* not JSON */
      }
      throw new EmbedHttpError(res.status, code, json);
    }
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('json') ? await res.json() : undefined) as T;
  }

  return {
    server: base,
    config: () => call<EmbedConfig>('embed.config', {}),
    createCapture: (body: EmbedCreateBody) => call<EmbedCapture>('embed.create', {}, { json: body }),
    putChunk: async (cap: EmbedCapture, stream: PageStream, seq: number, gz: Blob, t0: number, t1: number, keepalive = false) => {
      const headers: Record<string, string> = {
        'content-type': STREAM_CONTENT_TYPES[stream],
        'content-encoding': 'gzip',
        [HEADERS.t0]: String(Math.round(t0)),
        [HEADERS.t1]: String(Math.round(t1)),
      };
      const sha = await sha256Hex(gz);
      if (sha) headers[HEADERS.sha256] = sha;
      return call<{ seq: number }>('captures.putChunk', { id: cap.id, stream, seq }, { body: gz, headers, token: cap.uploadToken, keepalive });
    },
    completeStream: (cap: EmbedCapture, stream: PageStream, lastSeq: number, totalBytes: number) =>
      call('captures.completeStream', { id: cap.id, stream }, { json: { lastSeq, totalBytes }, token: cap.uploadToken }),
    finalize: (cap: EmbedCapture, body: { title: string; description: string; annotations: unknown[]; durationMs?: number }) =>
      call<{ id: string; status: string }>('captures.finalize', { id: cap.id }, { json: body, token: cap.uploadToken }),
    uploadAsset: async (cap: EmbedCapture, kind: 'feedback' | 'voice-note', file: Blob, filename: string) => {
      const fd = new FormData();
      fd.set('kind', kind);
      fd.set('recordingId', cap.id);
      const sha = kind === 'feedback' ? await sha256Hex(file) : null;
      if (sha) fd.set('sha256', sha);
      fd.set('file', file, filename);
      return call<{ id: string; url: string; kind: string }>('captures.uploadAsset', {}, { body: fd, token: cap.uploadToken });
    },
    createFeedback: (cap: EmbedCapture, items: FeedbackItemInput[]) => call<{ items: unknown[] }>('feedback.create', { id: cap.id }, { json: { items }, token: cap.uploadToken }),
  };
}

export type EmbedClient = ReturnType<typeof createEmbedClient>;

/** Hex sha256, or null where Web Crypto is missing (a plain-http origin other than localhost). */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function gzipText(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export const ndjson = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
