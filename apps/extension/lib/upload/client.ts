// HTTP client for the upload contract (packages/shared/src/api/captures.ts, architecture s5).
// URLs come from the route table with buildPath, never by hand (docs/parallel.md rule 5).
// Works in the service worker, the offscreen document and extension pages (fetch only).
import { ROUTES, buildPath } from '@toolbar/shared/api';
import { HEADERS } from '@toolbar/shared/constants';
import type { StreamName } from '@toolbar/shared';

export interface UploadAuthLike {
  serverUrl: string;
  /** device token (tb_dev_), personal token, or upload token (tb_upl_) of a recording link */
  token: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** Worth retrying later: network, 5xx, 429, 408. */
  get retryable() {
    return this.status === 0 || this.status >= 500 || this.status === 429 || this.status === 408;
  }
}

type RouteName = keyof typeof ROUTES;

async function call<T>(auth: UploadAuthLike, name: RouteName, params: Record<string, string | number>, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const route = ROUTES[name];
  const url = auth.serverUrl.replace(/\/$/, '') + buildPath(route.path, params);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${auth.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(url, { ...init, method: route.method, headers, body });
  } catch (e) {
    throw new HttpError(0, 'network', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      if (j.error) code = j.error;
      if (j.message) message = j.message;
    } catch {
      /* not JSON */
    }
    throw new HttpError(res.status, code, message || code);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? await res.json() : await res.text()) as T;
}

export interface CreateCaptureInput {
  clientId: string;
  kind: 'screenshot' | 'video' | 'replay' | 'screen' | 'link' | 'trace';
  workspaceId: string;
  folderId?: string;
  page: { url: string; title: string };
  startedAt: number;
  env?: unknown;
  source?: 'extension' | 'recording-link' | 'upload' | 'cli';
  durationMs?: number;
}

export const api = {
  createCapture: (a: UploadAuthLike, body: CreateCaptureInput) => call<{ id: string; shareUrl: string; uploadToken?: string }>(a, 'captures.create', {}, { json: body }),

  putChunk: (a: UploadAuthLike, id: string, stream: StreamName, seq: number, body: Blob, meta: { sha256: string; t0: number; t1: number; contentType: string; contentEncoding: 'gzip' | null }) => {
    const headers: Record<string, string> = {
      'content-type': meta.contentType,
      [HEADERS.sha256]: meta.sha256,
      [HEADERS.t0]: String(Math.round(meta.t0)),
      [HEADERS.t1]: String(Math.round(meta.t1)),
    };
    if (meta.contentEncoding) headers['content-encoding'] = meta.contentEncoding;
    return call<{ seq: number; stored: 'new' | 'duplicate' }>(a, 'captures.putChunk', { id, stream, seq }, { headers, body });
  },

  listChunks: (a: UploadAuthLike, id: string, stream: StreamName) =>
    call<{ stream: StreamName; chunks: { seq: number; bytes: number; sha256: string }[]; lastSeq: number | null; completed: boolean }>(a, 'captures.listChunks', { id, stream }),

  completeStream: (a: UploadAuthLike, id: string, stream: StreamName, body: { lastSeq: number; totalBytes: number }) =>
    call<{ stream: StreamName; completed: boolean; missing: number[] }>(a, 'captures.completeStream', { id, stream }, { json: body }),

  finalize: (a: UploadAuthLike, id: string, body: unknown) =>
    call<{ id: string; shareUrl: string; status: string; issue: unknown; issueError: string | null }>(a, 'captures.finalize', { id }, { json: body }),

  uploadAsset: (a: UploadAuthLike, fields: { kind: string; recordingId?: string; width?: number; height?: number; sha256?: string }, file: Blob, filename = 'file.png') => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, String(v));
    fd.set('file', file, filename);
    return call<{ id: string; url: string; kind: string }>(a, 'captures.uploadAsset', {}, { body: fd });
  },

  deleteCapture: (a: UploadAuthLike, id: string) => call<{ ok: true; purged: boolean }>(a, 'captures.delete', { id }),
};

export async function sha256Hex(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}
