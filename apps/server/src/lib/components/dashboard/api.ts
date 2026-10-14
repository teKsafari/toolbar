// Browser-side calls to contract routes (docs/parallel.md rule 5): URLs from buildPath, errors
// as ApiError with the contract's code.
import { ROUTES, buildPath, type RouteName } from '@toolbar/shared/api';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Q = Record<string, string | number | boolean | string[] | null | undefined>;

export function urlOf(name: RouteName, params: Record<string, string> = {}, query: Q = {}): string {
  const path = buildPath(ROUTES[name].path, params);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function api<T = unknown>(
  name: RouteName,
  opts: { params?: Record<string, string>; query?: Q; body?: unknown; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<T> {
  const r = ROUTES[name];
  const f = opts.fetch ?? fetch;
  const res = await f(urlOf(name, opts.params, opts.query), {
    method: r.method,
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'error', data.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Copy text and say so (J-159: toast after copy). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
