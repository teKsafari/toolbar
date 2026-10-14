// Helpers for /api/v1 handlers: JSON errors, auth guard, zod body parsing.
import { error, json, type RequestEvent } from '@sveltejs/kit';
import type { z } from 'zod';

export function apiError(status: number, code: string, message?: string, issues?: unknown) {
  return json({ error: code, message, issues }, { status });
}

export function requireUser(event: RequestEvent) {
  const u = event.locals.user;
  if (!u) error(401, { message: 'Sign in or send a bearer token', code: 'unauthorized' });
  return u;
}

export async function parseBody<S extends z.ZodType>(event: RequestEvent, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    error(400, { message: 'Body must be JSON', code: 'bad_json' });
  }
  const r = schema.safeParse(body);
  if (!r.success) error(422, { message: r.error.message, code: 'invalid_body' });
  return r.data;
}

export const notImplemented = (what: string) => apiError(501, 'not_implemented', `${what} is not built yet`);
