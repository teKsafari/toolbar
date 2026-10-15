// Building blocks for the endpoint contracts: route definitions, errors, paging, ids.
// Every endpoint in src/api/*.ts is a `defineRoute()` value; src/api/routes.ts collects them.
import { z } from 'zod';
import { API_PREFIX } from '../constants.ts';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Who may call a route.
 * - `public`: nobody needs to sign in (share pages, recording-link recorder, health).
 * - `member`: a browser session or `Authorization: Bearer tb_dev_|tb_pat_`, for a member of the
 *   capture's workspace.
 * - `viewer`: like `member`, or a share token in the `x-toolbar-share` header (logged-out viewer, J-121).
 * - `upload`: like `member`, or the per-capture upload token a recording-link recipient gets (J-017).
 * - `session`: a browser session only (pages that set cookies or redirect).
 */
export const AUTH_MODES = ['public', 'member', 'viewer', 'upload', 'session'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** Header that carries a share token on API calls made by the logged-out viewer. */
export const SHARE_TOKEN_HEADER = 'x-toolbar-share';
/** Prefix of the per-capture upload token returned to recording-link recipients. */
export const UPLOAD_TOKEN_PREFIX = 'tb_upl_';

/** Minimum workspace role for a route (J-124). Viewers view and comment; creators make captures. */
export const SEAT_ROLES = ['viewer', 'creator', 'admin'] as const;
export type SeatRole = (typeof SEAT_ROLES)[number];

/** Areas that own route handlers (docs/parallel.md). */
export const AREAS = ['server-core', 'auth', 'capture', 'ext-ui', 'editor', 'viewer', 'dashboard', 'agent'] as const;
export type Area = (typeof AREAS)[number];

// ---------- errors ----------

/**
 * Error codes in `{ error, message?, issues? }` bodies. The HTTP status for each is fixed so
 * clients can branch on either. Areas add codes in their own file and list them here at merge.
 */
export const ERROR_STATUS = {
  bad_json: 400,
  invalid_body: 422,
  invalid_query: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  hash_mismatch: 409,
  gone: 410,
  too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  integration_failed: 502,
  not_implemented: 501,
  unavailable: 503,
  // domain-specific
  invalid_code: 400,
  invalid_redirect_uri: 400,
  stream_incomplete: 409,
  already_finalized: 409,
  recording_cap_reached: 409,
  last_admin: 409,
  expired: 410,
  revoked: 410,
  // instance branding (D-112)
  locked_by_env: 409,
  invalid_image: 422,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export const errorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** Errors any authenticated route may return; routes list their extra codes in `errors`. */
export const COMMON_ERRORS = ['unauthorized', 'forbidden', 'not_found'] as const satisfies readonly ErrorCode[];

// ---------- primitives ----------

export const idSchema = z.uuid();
/** Wire timestamps are ISO 8601 strings. Event times inside captures stay epoch ms. */
export const isoSchema = z.iso.datetime({ offset: true });
export const urlSchema = z.url();
export const emailSchema = z.email();
/** A capture id or any URL that contains one (MCP and CLI accept both, agent-output.md). */
export const captureRefSchema = z.string().min(1);

export const personSchema = z.object({
  id: idSchema.nullable(),
  name: z.string(),
  email: z.string().nullable(),
  image: z.string().nullable(),
});
export type Person = z.infer<typeof personSchema>;

export const okSchema = z.object({ ok: z.literal(true) });

// ---------- paging ----------

/** Cursor paging for every list. `cursor` is opaque; pass `nextCursor` back unchanged. */
export const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/** List envelope, the same shape MCP and CLI return (agent-output.md "Tool conventions"). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative().optional(),
    returned: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  });
}
export type Page<T> = { items: T[]; total?: number; returned: number; hasMore: boolean; nextCursor: string | null };

/** Comma list in a query string ("a,b") or repeated keys, parsed to an array of enum values. */
export function csvOf<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => {
    if (v === undefined || v === '') return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
  }, z.array(item).optional());
}

export const boolQuery = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v === true || v === 'true' || v === '1'),
  z.boolean().optional(),
);

// ---------- route definitions ----------

/** Body kinds that are not JSON. */
export type RawBody = 'binary' | 'multipart' | 'none';
/** Response kinds that are not JSON. */
export type RawResponse = 'binary' | 'sse' | 'redirect' | 'html' | 'markdown' | 'none';

export interface RouteDef<
  P extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType | RawBody = z.ZodType | RawBody,
  R extends z.ZodType | RawResponse = z.ZodType | RawResponse,
> {
  /** Stable name, `area.verbNoun`. Clients and tests refer to routes by it. */
  name: string;
  method: HttpMethod;
  /** Express-style path with `:param` segments. API routes start with API_PREFIX. */
  path: string;
  auth: AuthMode;
  /** Minimum workspace role when auth is member/viewer/upload and a workspace is involved. */
  role?: SeatRole;
  /** Personal-token scope needed when called with a tb_pat_ token (J-148). */
  scope?: 'read' | 'write';
  params: P;
  query: Q;
  body: B;
  response: R;
  /** Success status (201 for creates). */
  status: number;
  errors: readonly ErrorCode[];
  area: Area;
  /** Catalogue rows (J-xxx) and foundation tasks (X-xx) this route serves. */
  tasks: readonly string[];
  summary: string;
  /**
   * Paused feature flags (docs/scope.md) this route belongs to. The API page and the API index
   * list it only while one of them is on.
   */
  paused?: readonly PausedFeature[];
}

/** Paused-feature flags as the server's featureFlags() names them (FEATURE_AI is `ai`, and so on). */
export type PausedFeature = 'email' | 'trackers' | 'slack' | 'cli' | 'ai' | 'adminExtras';

/** Is the route listed under these flags? Routes of paused features show only with a flag on. */
export function routeListed(r: { paused?: readonly PausedFeature[] }, flags: Partial<Record<PausedFeature, boolean>>): boolean {
  return !r.paused?.length || r.paused.some((f) => flags[f]);
}

const empty = z.object({});

/** Identity function that fills defaults and keeps the literal types for inference. */
export function defineRoute<
  const N extends string,
  P extends z.ZodType = typeof empty,
  Q extends z.ZodType = typeof empty,
  B extends z.ZodType | RawBody = 'none',
  R extends z.ZodType | RawResponse = 'none',
>(def: {
  name: N;
  method: HttpMethod;
  path: string;
  auth: AuthMode;
  role?: SeatRole;
  scope?: 'read' | 'write';
  params?: P;
  query?: Q;
  body?: B;
  response?: R;
  status?: number;
  errors?: readonly ErrorCode[];
  area: Area;
  tasks?: readonly string[];
  summary: string;
  paused?: readonly PausedFeature[];
}): RouteDef<P, Q, B, R> & { name: N } {
  return {
    params: empty as unknown as P,
    query: empty as unknown as Q,
    body: 'none' as B,
    response: 'none' as R,
    status: def.method === 'POST' ? 201 : 200,
    errors: def.auth === 'public' ? [] : COMMON_ERRORS,
    tasks: [],
    ...def,
  } as RouteDef<P, Q, B, R> & { name: N };
}

export const api = (p: string) => `${API_PREFIX}${p}`;

/** Path parameters named in a route path, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
}

/** Fill `:param` segments (URL-encoded). Throws when a parameter is missing. */
export function buildPath(path: string, params: Record<string, string | number> = {}): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`Missing path parameter ${k} for ${path}`);
    return encodeURIComponent(String(v));
  });
}

/** Match a concrete pathname against a route path; returns the params or null. */
export function matchPath(path: string, pathname: string): Record<string, string> | null {
  const names = pathParams(path);
  const re = new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?:[A-Za-z_][A-Za-z0-9_]*/g, '([^/]+)') + '/?$');
  const m = pathname.match(re);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
}

// Inference helpers for typed clients.
type Infer<T> = T extends z.ZodType ? z.infer<T> : never;
type Input<T> = T extends z.ZodType ? z.input<T> : never;
export type RouteParams<R extends RouteDef> = Input<R['params']>;
export type RouteQuery<R extends RouteDef> = Input<R['query']>;
export type RouteBody<R extends RouteDef> = R['body'] extends z.ZodType ? z.input<R['body']> : R['body'] extends 'none' ? undefined : BodyInit;
export type RouteResponse<R extends RouteDef> = R['response'] extends z.ZodType ? Infer<R['response']> : R['response'] extends 'none' ? void : Response;
