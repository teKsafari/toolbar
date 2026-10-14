// Contract-driven route handlers (docs/parallel.md rule 5). `apiRoute(ROUTES[name], fn)` parses
// params, query and JSON body with the route's zod schemas, maps thrown ApiErrors to
// `{ error, message?, issues? }` with the status from ERROR_STATUS, and serialises the result
// with the route's success status. Any area may import it.
import { isHttpError, isRedirect, json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import type { z } from 'zod';
import { ERROR_STATUS, type ErrorCode, type RouteDef } from '@toolbar/shared/api';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly issues?: unknown;
  readonly extra?: Record<string, unknown>;
  constructor(code: ErrorCode, message?: string, issues?: unknown, extra?: Record<string, unknown>) {
    super(message ?? code);
    this.code = code;
    this.issues = issues;
    this.extra = extra;
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export function fail(code: ErrorCode, message?: string, issues?: unknown, extra?: Record<string, unknown>): never {
  throw new ApiError(code, message, issues, extra);
}

export function errorJson(code: ErrorCode, message?: string, issues?: unknown, extra?: Record<string, unknown>, headers?: HeadersInit) {
  return json({ ...extra, error: code, message, issues }, { status: ERROR_STATUS[code], headers });
}

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'bad_json',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  413: 'too_large',
  415: 'unsupported_media_type',
  422: 'invalid_body',
  429: 'rate_limited',
  501: 'not_implemented',
  503: 'unavailable',
};

/** Turn anything thrown in a handler into a contract error response. */
export function toErrorResponse(e: unknown): Response {
  if (isRedirect(e)) throw e;
  if (e instanceof ApiError) return errorJson(e.code, e.message === e.code ? undefined : e.message, e.issues, e.extra);
  if (isHttpError(e)) {
    const body = e.body as { message?: string; code?: string };
    const code = (body.code && body.code in ERROR_STATUS ? body.code : STATUS_CODE[e.status]) as ErrorCode | undefined;
    return json({ error: code ?? 'error', message: body.message }, { status: e.status });
  }
  console.error('[api] unhandled error:', e);
  return json({ error: 'internal', message: 'Something went wrong on the server' }, { status: 500 });
}

/** Query string to a plain object; repeated keys become arrays. */
export function queryObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(params.keys())) {
    const all = params.getAll(k);
    out[k] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

type Z<T> = T extends z.ZodType ? z.output<T> : undefined;
type Out<R extends RouteDef> = R['response'] extends z.ZodType ? z.input<R['response']> | Response : Response;

export interface RouteContext<R extends RouteDef> {
  event: RequestEvent;
  params: Z<R['params']>;
  query: Z<R['query']>;
  body: R['body'] extends z.ZodType ? z.output<R['body']> : undefined;
}

const checkResponses = process.env.NODE_ENV !== 'production';

export function apiRoute<R extends RouteDef>(route: R, fn: (ctx: RouteContext<R>) => Promise<Out<R>> | Out<R>): RequestHandler {
  return async (event) => {
    try {
      const p = (route.params as z.ZodType).safeParse(event.params);
      if (!p.success) fail('not_found', 'Unknown path parameter', p.error.issues);
      const q = (route.query as z.ZodType).safeParse(queryObject(event.url.searchParams));
      if (!q.success) fail('invalid_query', 'Query does not match the contract', q.error.issues);
      let body: unknown = undefined;
      if (typeof route.body !== 'string') {
        let raw: unknown;
        const text = await event.request.text();
        try {
          raw = text === '' ? {} : JSON.parse(text);
        } catch {
          fail('bad_json', 'Body must be JSON');
        }
        const b = (route.body as z.ZodType).safeParse(raw);
        if (!b.success) fail('invalid_body', 'Body does not match the contract', b.error.issues);
        body = b.data;
      }
      const out = await fn({ event, params: p.data, query: q.data, body } as RouteContext<R>);
      if (out instanceof Response) return out;
      if (checkResponses && typeof route.response !== 'string') {
        const r = (route.response as z.ZodType).safeParse(out);
        if (!r.success) console.warn(`[api] ${route.name} response drifts from the contract:`, r.error.issues.slice(0, 3));
      }
      return json(out, { status: route.status });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}
