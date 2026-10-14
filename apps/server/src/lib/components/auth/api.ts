// Browser-side calls to the auth routes, URLs built from the contract (docs/parallel.md rule 5).
import { ROUTES, buildPath, type RouteDef } from '@toolbar/shared/api';

export class ApiCallError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function call<T>(route: RouteDef, params: Record<string, string> = {}, body?: unknown): Promise<T> {
  const res = await fetch(buildPath(route.path, params), {
    method: route.method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiCallError(data.error ?? 'error', data.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export { ROUTES };
