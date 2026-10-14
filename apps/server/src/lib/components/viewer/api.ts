// Browser client for the routes the capture page calls. URLs come from the route table
// (docs/parallel.md rule 5); share-link viewers send their token in x-nib-share (D-030).
import { buildPath, ROUTES, SHARE_TOKEN_HEADER } from '@toolbar/shared/api';

type RouteName = keyof typeof ROUTES;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let shareToken: string | null = null;
export const setShareToken = (t: string | null) => void (shareToken = t);
export const getShareToken = () => shareToken;

export function urlOf(name: RouteName, params: Record<string, string | number> = {}, query?: Record<string, string>): string {
  const path = buildPath(ROUTES[name].path, params);
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  return path + qs;
}

export async function call<T = unknown>(name: RouteName, params: Record<string, string | number> = {}, body?: unknown, init: RequestInit = {}): Promise<T> {
  const route = ROUTES[name];
  const headers = new Headers(init.headers);
  if (shareToken) headers.set(SHARE_TOKEN_HEADER, shareToken);
  if (body !== undefined && !(body instanceof FormData)) headers.set('content-type', 'application/json');
  const res = await fetch(urlOf(name, params), {
    ...init,
    method: route.method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Fetch a gzip or plain JSON file (events.json.gz) and parse it. */
export async function fetchJsonMaybeGzip<T>(url: string): Promise<T> {
  const headers = new Headers();
  if (shareToken) headers.set(SHARE_TOKEN_HEADER, shareToken);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError(res.status, 'not_found', `Could not load ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text()) as T;
  }
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

/** Copy text; falls back to a hidden textarea when the async clipboard is refused. */
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
