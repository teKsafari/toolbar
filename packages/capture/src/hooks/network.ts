// fetch, XMLHttpRequest and navigator.sendBeacon (J-058 to J-061, J-064 to J-066).
// net.req goes out when the page sends; net.res when the body has been read from a clone (or
// at once for binary, streamed and oversized bodies); net.fail on network error, abort or
// timeout. A request that never answers has a net.req and nothing else: the viewer shows it
// as pending (J-061). Bodies are read off the page's critical path and never block it.
import { LIMITS } from '@toolbar/shared/constants';
import { makeRidFactory } from '@toolbar/shared/ids';
import type { Headers, NetTiming } from '@toolbar/shared/events';
import type { Emit, HookInstaller } from '../transport.ts';
import { absoluteUrl, cap, isTextLike, now, quiet, replaceProp, wrapFn } from './util.ts';

/** How long to wait for a response body before reporting the response without it. */
export const BODY_WAIT_MS = 15_000;

export function headersToRecord(h: unknown): Headers | undefined {
  if (!h) return undefined;
  const out: Headers = {};
  try {
    if (typeof (h as globalThis.Headers).forEach === 'function' && !Array.isArray(h)) {
      (h as globalThis.Headers).forEach((v, k) => (out[k.toLowerCase()] = v));
    } else if (Array.isArray(h)) {
      for (const [k, v] of h as [string, string][]) out[String(k).toLowerCase()] = String(v);
    } else if (typeof h === 'object') {
      for (const [k, v] of Object.entries(h as Record<string, unknown>)) out[k.toLowerCase()] = String(v);
    }
  } catch {
    return undefined;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parses "Name: value\r\n" lines from getAllResponseHeaders(). */
export function parseRawHeaders(raw: string): Headers | undefined {
  const out: Headers = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** Request body as text when it is text; a size placeholder otherwise (J-066). */
export function bodyToText(body: unknown): { body?: string; truncated?: boolean } {
  if (body === undefined || body === null) return {};
  try {
    if (typeof body === 'string') {
      const c = cap(body, LIMITS.bodyBytes);
      return { body: c.text, truncated: c.truncated || undefined };
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return { body: body.toString() };
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const p = new URLSearchParams();
      body.forEach((v, k) => p.append(k, typeof v === 'string' ? v : `[file ${(v as File).name} ${(v as File).size} B]`));
      return { body: p.toString() };
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) return { body: `[binary ${body.size} B${body.type ? ` ${body.type}` : ''}]` };
    if (body instanceof ArrayBuffer) return { body: `[binary ${body.byteLength} B]` };
    if (ArrayBuffer.isView(body)) return { body: `[binary ${body.byteLength} B]` };
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return { body: '[stream]' };
  } catch {
    /* fall through */
  }
  return {};
}

/** GraphQL operation name from a request body (J-064). */
export function graphqlOf(body: string | undefined, url: string): { operationName: string | null } | undefined {
  let src: string | undefined = body;
  if (!src) {
    try {
      const u = new URL(url);
      src = u.searchParams.get('query') ? JSON.stringify({ query: u.searchParams.get('query'), operationName: u.searchParams.get('operationName') }) : undefined;
    } catch {
      return undefined;
    }
  }
  if (!src || !src.includes('query')) return undefined;
  try {
    const j = JSON.parse(src) as unknown;
    const first = (Array.isArray(j) ? j[0] : j) as { query?: unknown; operationName?: unknown } | null;
    if (!first || typeof first.query !== 'string') return undefined;
    if (typeof first.operationName === 'string' && first.operationName) return { operationName: first.operationName };
    const m = /\b(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/.exec(first.query);
    return { operationName: m ? m[2]! : null };
  } catch {
    return undefined;
  }
}

/** Count of GraphQL errors in a response body; undefined when the body is not a GraphQL reply. */
export function graphqlErrorsOf(body: string | undefined): number | undefined {
  if (!body || !body.includes('"errors"')) return undefined;
  try {
    const j = JSON.parse(body) as unknown;
    const arr = Array.isArray(j) ? j : [j];
    let n = 0;
    for (const r of arr) if (r && typeof r === 'object' && Array.isArray((r as { errors?: unknown }).errors)) n += (r as { errors: unknown[] }).errors.length;
    return n || undefined;
  } catch {
    return undefined;
  }
}

/** DNS, connect and TTFB from the Resource Timing entry for this URL (J-065). */
export function resourceTiming(url: string, start: number, end: number): NetTiming {
  const timing: NetTiming = { start, end };
  try {
    const entries = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
    const origin = performance.timeOrigin;
    const e = [...entries].reverse().find((x) => origin + x.startTime >= start - 20);
    if (e) {
      if (e.domainLookupEnd > 0) timing.dns = round(e.domainLookupEnd - e.domainLookupStart);
      if (e.connectEnd > 0) timing.connect = round(e.connectEnd - e.connectStart);
      if (e.responseStart > 0) timing.ttfb = round(e.responseStart - (e.requestStart || e.startTime));
    }
  } catch {
    /* timing is a bonus */
  }
  return timing;
}
const round = (n: number) => Math.round(n * 100) / 100;

function readBody(res: Response, ct: string | null): Promise<{ body?: string; truncated?: boolean; binary?: boolean; size?: number }> {
  if (!isTextLike(ct)) {
    const len = Number(res.headers.get('content-length'));
    return Promise.resolve({ binary: true, size: Number.isFinite(len) && len > 0 ? len : undefined });
  }
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > 8 * LIMITS.bodyBytes) return Promise.resolve({ truncated: true, size: len });
  let clone: Response;
  try {
    clone = res.clone();
  } catch {
    return Promise.resolve({});
  }
  const read = clone.text().then((t) => {
    const c = cap(t, LIMITS.bodyBytes);
    return { body: c.text, truncated: c.truncated || undefined, size: t.length };
  });
  const timeout = new Promise<{ truncated: boolean }>((r) => setTimeout(() => r({ truncated: true }), BODY_WAIT_MS));
  return Promise.race([read, timeout]).catch(() => ({}));
}

function installFetch(emit: Emit, win: Window & typeof globalThis, rid: () => string): () => void {
  const orig = win.fetch;
  if (typeof orig !== 'function') return () => {};
  const wrapped = wrapFn(orig, (target, thisArg, args) => {
    const p = Reflect.apply(target, thisArg, args) as Promise<Response>;
    quiet(() => {
      const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = absoluteUrl(isReq ? (input as Request).url : (input as string | URL));
      const method = String(init?.method ?? (isReq ? (input as Request).method : 'GET')).toUpperCase();
      const headers = { ...(isReq ? headersToRecord((input as Request).headers) : {}), ...headersToRecord(init?.headers) };
      const id = rid();
      const start = now();
      const b = bodyToText(init?.body);
      const graphql = graphqlOf(b.body, url);
      emit('net.req', {
        rid: id,
        method,
        url,
        headers: Object.keys(headers).length ? headers : undefined,
        ...(b.body !== undefined ? { body: b.body } : {}),
        ...(b.truncated ? { bodyTruncated: true } : {}),
        initiator: 'fetch',
        source: 'page',
        ...(graphql ? { graphql } : {}),
      });
      p.then(
        (res) =>
          quiet(() => {
            const ttfbAt = now();
            const ct = res.headers.get('content-type');
            const rh = headersToRecord(res.headers);
            void readBody(res, ct).then((rb) =>
              quiet(() => {
                const end = now();
                const timing = resourceTiming(url, start, end);
                if (timing.ttfb === undefined) timing.ttfb = round(ttfbAt - start);
                const gErr = graphqlErrorsOf(rb.body);
                emit('net.res', {
                  rid: id,
                  status: res.status,
                  ...(res.statusText ? { statusText: res.statusText } : {}),
                  headers: rh,
                  ...(rb.body !== undefined ? { body: rb.body } : {}),
                  ...(rb.truncated ? { truncated: true } : {}),
                  ...(rb.binary ? { binary: true } : {}),
                  ...(ct ? { contentType: ct } : {}),
                  ...(rb.size !== undefined ? { encodedSize: rb.size } : {}),
                  timing,
                  source: 'page',
                  ...(gErr ? { graphqlErrors: gErr } : {}),
                });
              }),
            );
          }),
        (err: unknown) =>
          quiet(() => {
            const e = err as { name?: string; message?: string };
            const error = e?.name === 'AbortError' ? 'abort' : e?.name === 'TimeoutError' ? 'timeout' : `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`;
            emit('net.fail', { rid: id, error, source: 'page' });
          }),
      );
    });
    return p;
  });
  return replaceProp(win, 'fetch', wrapped);
}

interface XhrInfo {
  method: string;
  url: string;
  headers: Headers;
  rid?: string;
  start?: number;
}

function installXhr(emit: Emit, win: Window & typeof globalThis, rid: () => string): () => void {
  const X = win.XMLHttpRequest;
  if (typeof X !== 'function') return () => {};
  const proto = X.prototype;
  const info = new WeakMap<XMLHttpRequest, XhrInfo>();
  const open = proto.open;
  const setHeader = proto.setRequestHeader;
  const send = proto.send;

  const wOpen = wrapFn(open as (...a: unknown[]) => void, (target, xhr, args) => {
    quiet(() => info.set(xhr as XMLHttpRequest, { method: String(args[0] ?? 'GET').toUpperCase(), url: absoluteUrl(String(args[1])), headers: {} }));
    return Reflect.apply(target, xhr, args) as void;
  });
  const wSetHeader = wrapFn(setHeader, (target, xhr, args) => {
    quiet(() => {
      const i = info.get(xhr as XMLHttpRequest);
      if (i) i.headers[String(args[0]).toLowerCase()] = String(args[1]);
    });
    return Reflect.apply(target, xhr, args) as void;
  });
  const wSend = wrapFn(send, (target, xhrAny, args) => {
    const xhr = xhrAny as XMLHttpRequest;
    quiet(() => {
      const i = info.get(xhr);
      if (!i) return;
      const id = rid();
      i.rid = id;
      i.start = now();
      const b = bodyToText(args[0]);
      const graphql = graphqlOf(b.body, i.url);
      emit('net.req', {
        rid: id,
        method: i.method,
        url: i.url,
        headers: Object.keys(i.headers).length ? { ...i.headers } : undefined,
        ...(b.body !== undefined ? { body: b.body } : {}),
        ...(b.truncated ? { bodyTruncated: true } : {}),
        initiator: 'xhr',
        source: 'page',
        ...(graphql ? { graphql } : {}),
      });
      let done = false;
      const finish = (kind: 'load' | 'error' | 'abort' | 'timeout') =>
        quiet(() => {
          if (done) return;
          done = true;
          if (kind !== 'load') {
            emit('net.fail', { rid: id, error: kind === 'error' ? 'net::ERR_FAILED' : kind, source: 'page' });
            return;
          }
          const ct = xhr.getResponseHeader('content-type');
          let body: string | undefined;
          let truncated = false;
          let binary = false;
          let size: number | undefined;
          const rt = xhr.responseType;
          if ((rt === '' || rt === 'text') && isTextLike(ct)) {
            const c = cap(xhr.responseText, LIMITS.bodyBytes);
            body = c.text;
            truncated = c.truncated;
            size = xhr.responseText.length;
          } else if (rt === 'json' && xhr.response !== null) {
            const c = cap(JSON.stringify(xhr.response), LIMITS.bodyBytes);
            body = c.text;
            truncated = c.truncated;
          } else if (rt === 'document') {
            body = undefined;
          } else {
            binary = true;
            const r = xhr.response as Blob | ArrayBuffer | null;
            size = r instanceof Blob ? r.size : r instanceof ArrayBuffer ? r.byteLength : undefined;
          }
          const end = now();
          const gErr = graphqlErrorsOf(body);
          emit('net.res', {
            rid: id,
            status: xhr.status,
            ...(xhr.statusText ? { statusText: xhr.statusText } : {}),
            headers: parseRawHeaders(xhr.getAllResponseHeaders()),
            ...(body !== undefined ? { body } : {}),
            ...(truncated ? { truncated: true } : {}),
            ...(binary ? { binary: true } : {}),
            ...(ct ? { contentType: ct } : {}),
            ...(size !== undefined ? { encodedSize: size } : {}),
            timing: resourceTiming(i.url, i.start!, end),
            source: 'page',
            ...(gErr ? { graphqlErrors: gErr } : {}),
          });
        });
      xhr.addEventListener('load', () => finish('load'));
      xhr.addEventListener('error', () => finish('error'));
      xhr.addEventListener('abort', () => finish('abort'));
      xhr.addEventListener('timeout', () => finish('timeout'));
    });
    return Reflect.apply(target, xhr, args) as void;
  });
  const r1 = replaceProp(proto, 'open', wOpen as typeof open);
  const r2 = replaceProp(proto, 'setRequestHeader', wSetHeader);
  const r3 = replaceProp(proto, 'send', wSend);
  return () => {
    r3();
    r2();
    r1();
  };
}

function installBeacon(emit: Emit, win: Window & typeof globalThis, rid: () => string): () => void {
  const nav = win.navigator as Navigator | undefined;
  if (!nav || typeof nav.sendBeacon !== 'function') return () => {};
  const orig = nav.sendBeacon;
  const wrapped = wrapFn(orig, (target, thisArg, args) => {
    const ok = Reflect.apply(target, thisArg, args) as boolean;
    quiet(() => {
      const b = bodyToText(args[1]);
      emit('net.req', { rid: rid(), method: 'POST', url: absoluteUrl(String(args[0])), ...(b.body !== undefined ? { body: b.body } : {}), initiator: 'beacon', source: 'page' });
    });
    return ok;
  });
  // sendBeacon lives on Navigator.prototype; shadow it on that prototype.
  const proto = Object.getPrototypeOf(nav) as Navigator;
  return replaceProp(proto, 'sendBeacon', wrapped);
}

export const installNetworkHook: HookInstaller = (emit, win) => {
  const ctx = win.top === win ? 'top' : 'frame';
  const rid = makeRidFactory(`${ctx}-${Math.random().toString(36).slice(2, 6)}`);
  const undo = [installFetch(emit, win, rid), installXhr(emit, win, rid), installBeacon(emit, win, rid)];
  return () => {
    for (const u of undo.reverse()) u();
  };
};
