// Upload client of the page bundle (D-131). It calls the server through the injector's relay on
// the app's own origin (/__toolbar/api/...), which adds the reviewer's bearer token; the page never
// holds a credential. It uses the fetch saved before the capture hooks were installed, so its
// own requests stay out of the reviewer's network log.
//
// Paths are spelled out instead of read from ROUTES so the bundle does not carry zod;
// test/page-upload.test.ts checks each one against the route table.
import { HEADERS, STREAM_CONTENT_TYPES } from '@toolbar/shared/constants';
import type { ProjectScope } from '@toolbar/shared/projects';

export const RELAY = '/__toolbar';

export const PAGE_ROUTES = {
  'ext.bootstrap': { method: 'GET', path: '/api/v1/ext/bootstrap' },
  'captures.create': { method: 'POST', path: '/api/v1/recordings' },
  'captures.putChunk': { method: 'PUT', path: '/api/v1/recordings/:id/streams/:stream/chunks/:seq' },
  'captures.completeStream': { method: 'POST', path: '/api/v1/recordings/:id/streams/:stream/complete' },
  'captures.finalize': { method: 'POST', path: '/api/v1/recordings/:id/finalize' },
} as const;

type RouteName = keyof typeof PAGE_ROUTES;
export type PageStream = 'events' | 'rrweb';

export class PageHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface Bootstrap {
  user: { id: string; name: string; email: string };
  activeWorkspaceId: string | null;
  workspaces: { id: string; name: string }[];
  branding?: { name?: string; accent?: string };
  /** projects of every workspace the reviewer belongs to (D-123) */
  projects?: ProjectScope[];
}

const fill = (path: string, params: Record<string, string | number>) => path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(String(params[k])));

export function createPageClient(nativeFetch: typeof fetch, base = RELAY) {
  async function call<T>(name: RouteName, params: Record<string, string | number>, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; keepalive?: boolean } = {}): Promise<T> {
    const r = PAGE_ROUTES[name];
    const headers: Record<string, string> = { 'x-toolbar-page': '1', ...init.headers };
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    let res: Response;
    try {
      res = await nativeFetch(base + fill(r.path, params), { method: r.method, headers, body, credentials: 'same-origin', keepalive: init.keepalive, cache: 'no-store' });
    } catch {
      throw new PageHttpError(0, 'network');
    }
    if (!res.ok) {
      let code = `http_${res.status}`;
      try {
        code = ((await res.json()) as { error?: string }).error ?? code;
      } catch {
        /* not JSON */
      }
      throw new PageHttpError(res.status, code);
    }
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('json') ? await res.json() : undefined) as T;
  }

  return {
    bootstrap: () => call<Bootstrap>('ext.bootstrap', {}),
    createCapture: (body: { clientId: string; kind: 'replay' | 'trace'; workspaceId: string; page: { url: string; title: string }; startedAt: number; env?: unknown; source: 'injector'; durationMs?: number }) =>
      call<{ id: string; shareUrl: string }>('captures.create', {}, { json: body }),
    putChunk: async (id: string, stream: PageStream, seq: number, gz: Blob, t0: number, t1: number, keepalive = false) => {
      const headers: Record<string, string> = {
        'content-type': STREAM_CONTENT_TYPES[stream],
        'content-encoding': 'gzip',
        [HEADERS.t0]: String(Math.round(t0)),
        [HEADERS.t1]: String(Math.round(t1)),
      };
      const sha = await sha256Hex(gz);
      if (sha) headers[HEADERS.sha256] = sha;
      return call<{ seq: number }>('captures.putChunk', { id, stream, seq }, { body: gz, headers, keepalive });
    },
    completeStream: (id: string, stream: PageStream, lastSeq: number, totalBytes: number) => call('captures.completeStream', { id, stream }, { json: { lastSeq, totalBytes } }),
    finalize: (id: string, body: { title: string; description: string; annotations: unknown[]; durationMs?: number }) =>
      call<{ id: string; shareUrl: string; status: string }>('captures.finalize', { id }, { json: body }),
  };
}

export type PageClient = ReturnType<typeof createPageClient>;

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
