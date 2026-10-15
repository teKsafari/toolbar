// Request authorisation against the route table (X-06, J-124, J-148) and a small handler
// wrapper that parses params, query and body with a route's zod schemas. Owner: auth area.
//
// `apiGate` runs in hooks.server.ts after the session or bearer token is resolved. For every
// request that matches a route in ROUTE_LIST it enforces the route's auth mode, the scope of a
// personal token, and the minimum seat role when the path (or a JSON body's workspaceId) names a workspace. Handlers of every
// area get this for free; routes whose workspace comes from a capture or folder check the seat
// themselves with `requireSeat()`.
import { json, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { z } from 'zod';
import {
  ERROR_STATUS,
  ROUTE_LIST,
  SHARE_TOKEN_HEADER,
  UPLOAD_TOKEN_PREFIX,
  matchPath,
  pathParams,
  roleAtLeast,
  routeListed,
  type ErrorCode,
  type RouteDef,
  type SeatRole,
} from '@toolbar/shared/api';
import { neededScope, tokenAllows } from '@toolbar/shared/areas/auth';
import { db } from '../db/index.ts';
import { featureFlags } from '../env.ts';
import { ensureCanCreate, seatRole } from './workspaces.ts';

/**
 * Paused routes that answer for themselves while their flag is off (503 unavailable, D-108);
 * every other route of a paused feature answers 404 (D-114).
 */
const SELF_GATED = new Set(['captures.aiDraft', 'workspaces.audit']);

export class ApiFail extends Error {
  constructor(
    public code: ErrorCode,
    message?: string,
    public issues?: unknown,
  ) {
    super(message ?? code);
  }
}

export const fail = (code: ErrorCode, message?: string, issues?: unknown): never => {
  throw new ApiFail(code, message, issues);
};

export function errorResponse(code: ErrorCode, message?: string, issues?: unknown): Response {
  return json({ error: code, message, issues }, { status: ERROR_STATUS[code] });
}

const routes = ROUTE_LIST as readonly RouteDef[];

/** The route for a method and pathname. Static segments win over parameters. */
export function findRoute(method: string, pathname: string): { route: RouteDef; params: Record<string, string> } | null {
  const m = method === 'HEAD' ? 'GET' : method;
  let best: { route: RouteDef; params: Record<string, string>; n: number } | null = null;
  for (const r of routes) {
    if (r.method !== m) continue;
    const params = matchPath(r.path, pathname);
    if (!params) continue;
    const n = pathParams(r.path).length;
    if (!best || n < best.n) best = { route: r, params, n };
  }
  return best && { route: best.route, params: best.params };
}

type Locals = Pick<App.Locals, 'user' | 'apiToken'>;

/**
 * Decide whether a request may reach its handler. Returns null to let it through, or the
 * error code and message to answer with. Pure apart from the seat lookup.
 */
export async function authorize(
  route: RouteDef,
  params: Record<string, string>,
  locals: Locals,
  headers: Headers,
  lookupSeat: (userId: string, workspaceId: string) => Promise<SeatRole | null> = (u, w) => seatRole(db, u, w),
): Promise<{ code: ErrorCode; message: string } | null> {
  if (route.auth === 'public') return null;
  const user = locals.user;
  const token = locals.apiToken;
  if (route.auth === 'session') {
    if (token) return { code: 'forbidden', message: 'This call needs a browser session, not an API token.' };
    if (!user) return { code: 'unauthorized', message: 'Sign in first.' };
  }
  if (!user) {
    if (route.auth === 'viewer' && headers.get(SHARE_TOKEN_HEADER)) return null;
    if (route.auth === 'upload' && (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').startsWith(UPLOAD_TOKEN_PREFIX)) return null;
    return { code: 'unauthorized', message: 'Sign in or send a bearer token.' };
  }
  if (token?.kind === 'personal') {
    const need = neededScope(route);
    if (!tokenAllows(token.scopes ?? [], 'cli', need))
      return { code: 'forbidden', message: `This token is not allowed to ${need === 'write' ? 'make changes' : 'read'} over the HTTP API (needs cli:${need}).` };
  }
  const ws = params.workspaceId;
  if (route.role && ws && z.uuid().safeParse(ws).success) {
    const seat = await lookupSeat(user.id, ws);
    if (!seat) return { code: 'not_found', message: 'No such workspace.' };
    if (!roleAtLeast(seat, route.role)) return { code: 'forbidden', message: `This needs the ${route.role} seat or higher.` };
  }
  return null;
}

/** hooks.server.ts handle: auth mode, token scope and seat checks for every contract route. */
export const apiGate: Handle = async ({ event, resolve }) => {
  const p = event.url.pathname;
  if (!(p.startsWith('/api/v1/') || p === '/ext/connect')) return resolve(event);
  const hit = findRoute(event.request.method, p);
  if (!hit) return resolve(event);
  // routes of paused features (docs/scope.md) do not exist while their flags are off
  if (!SELF_GATED.has(hit.route.name) && !routeListed(hit.route, featureFlags())) return errorResponse('not_found', 'Not found');
  // /ext/connect redirects to the login page itself when signed out.
  if (hit.route.name === 'ext.connect' && !event.locals.user) return resolve(event);
  let params = hit.params;
  // The workspace of some writes (captures.create) is in the JSON body, not the path.
  if (hit.route.role && !params.workspaceId && event.locals.user) {
    const ws = await bodyWorkspaceId(event.request);
    if (ws) params = { ...params, workspaceId: ws };
  }
  // J-124: a viewer creating a capture becomes a creator when the workspace auto-approves.
  // authorize() looks the seat up only after the auth mode and token scope passed.
  const lookup =
    hit.route.name === 'captures.create'
      ? (u: string, w: string) => ensureCanCreate(db, u, w)
      : (u: string, w: string) => seatRole(db, u, w);
  const denied = await authorize(hit.route, params, event.locals, event.request.headers, lookup);
  if (denied) return errorResponse(denied.code, denied.message);
  return resolve(event);
};

/** `workspaceId` from a JSON request body, read from a clone so the handler still gets the body. */
export async function bodyWorkspaceId(request: Request): Promise<string | null> {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return null;
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return null;
  try {
    const body = (await request.clone().json()) as unknown;
    const ws = body && typeof body === 'object' ? (body as { workspaceId?: unknown }).workspaceId : undefined;
    return typeof ws === 'string' && ws ? ws : null;
  } catch {
    return null;
  }
}

/** For handlers whose workspace is not in the path: the caller's seat, or a thrown 403/404. */
export async function requireSeat(event: RequestEvent, workspaceId: string, need: SeatRole): Promise<SeatRole> {
  const u = event.locals.user;
  if (!u) fail('unauthorized', 'Sign in first.');
  const seat = await seatRole(db, u!.id, workspaceId);
  if (!seat) fail('not_found', 'No such workspace.');
  if (!roleAtLeast(seat!, need)) fail('forbidden', `This needs the ${need} seat or higher.`);
  return seat!;
}

function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(k);
    out[k] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

export interface Ctx<R extends RouteDef> {
  event: RequestEvent;
  params: z.infer<R['params']>;
  query: z.infer<R['query']>;
  body: R['body'] extends z.ZodType ? z.infer<R['body']> : undefined;
  /** the signed-in user; null only on public routes */
  user: NonNullable<App.Locals['user']>;
}

type Out<R extends RouteDef> = (R['response'] extends z.ZodType ? z.input<R['response']> : never) | Response;

/**
 * Wrap a handler for a contract route: parses params, query and a JSON body with the route's
 * schemas (422 invalid_*), answers with the route's success status, and turns ApiFail into
 * `{ error, message }`. Authorisation already ran in apiGate.
 */
export function endpoint<R extends RouteDef>(route: R, fn: (ctx: Ctx<R>) => Promise<Out<R>> | Out<R>) {
  return async (event: RequestEvent): Promise<Response> => {
    try {
      const params = route.params.safeParse(event.params);
      if (!params.success) return errorResponse('not_found', 'Bad path parameter.', params.error.issues);
      const query = route.query.safeParse(queryObject(event.url));
      if (!query.success) return errorResponse('invalid_query', 'Query does not match.', query.error.issues);
      let body: unknown = undefined;
      if (typeof route.body !== 'string') {
        let raw: unknown;
        try {
          const text = await event.request.text();
          raw = text ? JSON.parse(text) : {};
        } catch {
          return errorResponse('bad_json', 'Body must be JSON.');
        }
        const b = (route.body as z.ZodType).safeParse(raw);
        if (!b.success) return errorResponse('invalid_body', 'Body does not match.', b.error.issues);
        body = b.data;
      }
      const out = await fn({
        event,
        params: params.data as Ctx<R>['params'],
        query: query.data as Ctx<R>['query'],
        body: body as Ctx<R>['body'],
        user: event.locals.user as Ctx<R>['user'],
      });
      if (out instanceof Response) return out;
      return json(out, { status: route.status });
    } catch (e) {
      if (e instanceof ApiFail) return errorResponse(e.code, e.message, e.issues);
      throw e;
    }
  };
}
