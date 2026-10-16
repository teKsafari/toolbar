// Projects (Part 2 "Zero integration" and "Privacy", D-123 to D-127): a project belongs to a
// workspace, lists the origins the extension may run on and picks one of two masking presets.
// Pure functions, no DOM and no zod, so the service worker, the isolated world, the server and
// the tests share one definition of "this URL belongs to that project".

/** The two presets a project can pick (PLAN "Privacy"). Capture events also know 'none' (Part 1). */
export const PROJECT_PRESETS = ['staging', 'production'] as const;
export type ProjectPreset = (typeof PROJECT_PRESETS)[number];

export const PRESET_LABELS: Record<ProjectPreset, string> = {
  staging: 'Staging, own team',
  production: 'Production',
};

/** One line per preset, for the dashboard and the docs. */
export const PRESET_SUMMARY: Record<ProjectPreset, string> = {
  staging: 'Page text is recorded as is. Request and response bodies are kept for the app’s own origins.',
  production: 'All text and inputs are masked, images and media are blocked, and bodies are kept only for allowlisted URLs.',
};

/** What the extension and the server need of a project. */
export interface ProjectScope {
  id: string;
  workspaceId: string;
  name: string;
  /** normalized origins: `https://app.example.com`, `http://localhost:5173`, `https://*.example.com` */
  origins: string[];
  maskingPreset: ProjectPreset;
  /** production only: URL prefixes whose bodies are kept (`*` matches any run of characters) */
  bodyAllowlist: string[];
  /**
   * Traces: how long an action's span stays open while its requests are still in flight, in ms
   * (PLAN "What a trace is", D-166).
   */
  traceOpenMs: number;
}

/** The span window for open requests (D-166): 10 s by default; code runs can take longer. */
export const TRACE_OPEN_MS = { default: 10_000, min: 3_000, max: 600_000 } as const;

/** The project's span window, clamped, or the default. */
export function traceOpenMsOf(p: { traceOpenMs?: number } | null | undefined): number {
  const v = p?.traceOpenMs;
  if (typeof v !== 'number' || !Number.isFinite(v)) return TRACE_OPEN_MS.default;
  return Math.min(TRACE_OPEN_MS.max, Math.max(TRACE_OPEN_MS.min, Math.round(v)));
}

export const LIMITS_PROJECT = { origins: 50, allowlist: 50, name: 80 } as const;

/**
 * An origin as typed by a person, normalized: scheme (http or https, https when missing), host in
 * lower case, port only when it is not the scheme's default, no path. A leading `*.` label is a
 * wildcard for subdomains. Returns null for anything else (paths are dropped, not refused).
 */
export function normalizeOrigin(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const m = /^(https?):\/\/(\*\.)?([^/?#:]+)(?::(\d{1,5}))?(?:[/?#].*)?$/i.exec(raw);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const wild = !!m[2];
  const host = m[3]!.toLowerCase().replace(/\.$/, '');
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/.test(host)) return null;
  if (host.split('.').some((l) => l.startsWith('-') || l.endsWith('-'))) return null;
  // `*.com` would cover a whole top-level domain
  if (wild && !host.includes('.')) return null;
  let port = m[4] ? Number(m[4]) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  if ((scheme === 'https' && port === 443) || (scheme === 'http' && port === 80)) port = null;
  return `${scheme}://${wild ? '*.' : ''}${host}${port !== null ? `:${port}` : ''}`;
}

/** Chrome match pattern for a normalized origin: what permissions.request and registerContentScripts take. */
export function matchPatternOf(origin: string): string {
  return `${origin}/*`;
}

/** The normalized origin a match pattern was made from (`https://a.test/*` to `https://a.test`). */
export function originOfPattern(pattern: string): string | null {
  return normalizeOrigin(pattern.replace(/\/\*$/, ''));
}

interface Parsed {
  scheme: string;
  host: string;
  port: string;
}

function parse(url: string): Parsed | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { scheme: u.protocol.slice(0, -1), host: u.hostname.toLowerCase(), port: u.port };
  } catch {
    return null;
  }
}

/**
 * Whether `url` falls under a normalized origin. Follows Chrome's match patterns, so the server
 * accepts exactly the pages the extension can run on: the scheme must be equal, `*.example.com`
 * covers example.com and its subdomains, and an origin without a port covers every port.
 */
export function originMatches(origin: string, url: string): boolean {
  const o = /^(https?):\/\/(\*\.)?([^/:]+)(?::(\d+))?$/.exec(origin);
  const u = parse(url);
  if (!o || !u) return false;
  if (o[1] !== u.scheme) return false;
  if (o[4] && o[4] !== u.port) return false;
  const host = o[3]!;
  if (o[2]) return u.host === host || u.host.endsWith(`.${host}`);
  return u.host === host;
}

/**
 * How specific a normalized origin is, for matching precedence (D-200): an exact origin beats any
 * wildcard domain, an exact host with a port beats one without (which covers every port), and a
 * longer wildcard domain beats a shorter one (`*.app.nuru.sh` before `*.nuru.sh`).
 */
export function originSpecificity(origin: string): number {
  const o = /^(https?):\/\/(\*\.)?([^/:]+)(?::(\d+))?$/.exec(origin);
  if (!o) return 0;
  if (o[2]) return 1_000 + o[3]!.length;
  return o[4] ? 3_000 : 2_000;
}

/** The most specific origin of `origins` that covers `url`, with its specificity; null when none does. */
export function bestOriginFor(origins: readonly string[], url: string): { origin: string; score: number } | null {
  let best: { origin: string; score: number } | null = null;
  for (const o of origins) {
    if (!originMatches(o, url)) continue;
    const score = originSpecificity(o);
    if (!best || score > best.score) best = { origin: o, score };
  }
  return best;
}

/**
 * The project whose origins cover `url`, or null. Precedence (D-200): the project with an exact
 * origin for the page wins over one that covers it by a wildcard domain, and among wildcards the
 * most specific wins. On a tie the earlier project in the list wins (callers list oldest first).
 */
export function projectForUrl<P extends Pick<ProjectScope, 'origins'>>(projects: readonly P[], url: string | null | undefined): P | null {
  if (!url) return null;
  let best: P | null = null;
  let bestScore = 0;
  for (const p of projects) {
    const m = bestOriginFor(p.origins, url);
    if (m && m.score > bestScore) {
      best = p;
      bestScore = m.score;
    }
  }
  return best;
}

/**
 * Site access (D-200). `all`: the extension asks Chrome once for every site, and the first capture
 * on an origin makes a project for it. `projects`: the strict mode of D-126, capture only on the
 * origins of projects, each approved in Chrome.
 */
export const SITE_ACCESS_MODES = ['all', 'projects'] as const;
export type SiteAccessMode = (typeof SITE_ACCESS_MODES)[number];

/** The exact origin (scheme, host, port when not the default) of a page; null for anything but http(s). */
export function pageOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // a wildcard is a project's domain pattern, never a page
    if (/[*%]/.test(u.hostname)) return null;
    return normalizeOrigin(u.origin);
  } catch {
    return null;
  }
}

/**
 * The project the first capture on an origin creates in `all` mode (D-200): named after the host
 * (the hostname, with the port when it is not the scheme's default), with that one origin.
 */
export function autoProjectOf(url: string | null | undefined): { name: string; origins: string[] } | null {
  const origin = pageOrigin(url);
  if (!origin) return null;
  const host = origin.replace(/^https?:\/\//, '');
  return { name: host.slice(0, LIMITS_PROJECT.name), origins: [origin] };
}

/**
 * The origins of two projects merged (D-200): the first project's in their order, then those of
 * the second it does not list yet. Throws a RangeError past the project limit.
 */
export function mergeOrigins(into: readonly string[], from: readonly string[]): string[] {
  const out = [...into];
  for (const o of from) if (!out.includes(o)) out.push(o);
  if (out.length > LIMITS_PROJECT.origins) throw new RangeError(`A project holds at most ${LIMITS_PROJECT.origins} origins`);
  return out;
}

/** Every origin of every project, once each, in a stable order. */
export function allOrigins(projects: readonly Pick<ProjectScope, 'origins'>[]): string[] {
  return [...new Set(projects.flatMap((p) => p.origins))].sort();
}

/** An allowlist entry: an absolute URL prefix, `*` matching any run of characters. */
export function normalizeAllowlistEntry(input: string): string | null {
  const s = input.trim();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  if (!/^https?:\/\/[^/]+/i.test(s.replace(/\*/g, 'x'))) return null;
  return s;
}

/** Whether a request URL matches an allowlist entry (prefix match, `*` wildcard). */
export function allowlistMatches(entry: string, url: string): boolean {
  const re = new RegExp(`^${entry.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}`, 'i');
  return re.test(url);
}

/**
 * What the isolated world needs to decide which bodies to keep. `preset: 'none'` (no project,
 * Part 1 behavior and the test builds) keeps every body.
 */
export interface BodyPolicy {
  preset: ProjectPreset | 'none';
  /** the project's origins; staging keeps bodies for these and for the page's own origin */
  origins: string[];
  /** production keeps bodies only for these */
  allowlist: string[];
}

export const OPEN_BODY_POLICY: BodyPolicy = { preset: 'none', origins: [], allowlist: [] };

export function bodyPolicyOf(p: Pick<ProjectScope, 'maskingPreset' | 'origins' | 'bodyAllowlist'> | null | undefined): BodyPolicy {
  if (!p) return OPEN_BODY_POLICY;
  return { preset: p.maskingPreset, origins: [...p.origins], allowlist: [...p.bodyAllowlist] };
}

/** Whether request and response bodies of `requestUrl`, seen on `pageUrl`, may be kept. */
export function bodyAllowed(policy: BodyPolicy, requestUrl: string, pageUrl?: string): boolean {
  if (policy.preset === 'none') return true;
  let abs = requestUrl;
  try {
    abs = new URL(requestUrl, pageUrl).href;
  } catch {
    return false;
  }
  if (policy.preset === 'production') return policy.allowlist.some((e) => allowlistMatches(e, abs));
  // staging: the app's own API, meaning the page's origin and the project's origins
  try {
    if (pageUrl && new URL(abs).origin === new URL(pageUrl).origin) return true;
  } catch {
    /* fall through */
  }
  return policy.origins.some((o) => originMatches(o, abs));
}
