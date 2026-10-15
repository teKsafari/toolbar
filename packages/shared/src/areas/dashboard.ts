// Shared types and constants the dashboard area adds (import from '@toolbar/shared/areas/dashboard').
// Only the dashboard area edits this file.
import { CAPTURE_SOURCES, type CaptureSource } from '../api/captures.ts';
import { RECORDING_KINDS, type RecordingKind } from '../constants.ts';

/** J-018: event and mark shared with the extension; see ./dashboard-ext.ts. */
export { NEW_CAPTURE_EVENT, EXTENSION_MARK_ATTR } from './dashboard-ext.ts';

/** Upload limit for an existing video (J-020): 200 MB, as Jam. */
export const MAX_UPLOAD_VIDEO_BYTES = 200 * 1024 * 1024;
export const UPLOAD_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

/** Kinds offered by the type filter (J-160). `screen` counts as video in the UI. */
export const TYPE_FILTERS = [
  { value: 'screenshot', label: 'Screenshot', kinds: ['screenshot'] },
  { value: 'video', label: 'Video', kinds: ['video', 'screen', 'link'] },
  { value: 'replay', label: 'Instant replay', kinds: ['replay'] },
  { value: 'trace', label: 'Trace', kinds: ['trace'] },
] as const satisfies readonly { value: string; label: string; kinds: readonly RecordingKind[] }[];
export type TypeFilter = (typeof TYPE_FILTERS)[number]['value'];

export const SOURCE_LABELS: Record<CaptureSource, string> = {
  extension: 'Extension',
  'recording-link': 'Recording link',
  upload: 'Upload',
  cli: 'CLI',
  /** the in-page toolbar the injector adds (D-117) */
  injector: 'Toolbar on the site',
};

/** Grid filter state; lives in the URL (J-160) as ?type=a,b&source=a&by=<id>,<id>&link=<id>. */
export interface GridFilters {
  types: TypeFilter[];
  sources: CaptureSource[];
  authors: string[];
  link: string | null;
}

const list = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export function filtersFromParams(p: { get(key: string): string | null }, meId?: string): GridFilters {
  const typeVals = TYPE_FILTERS.map((t) => t.value) as string[];
  const by = list(p.get('by')).map((a) => (a === 'me' && meId ? meId : a));
  return {
    types: list(p.get('type')).filter((t): t is TypeFilter => typeVals.includes(t)),
    sources: list(p.get('source')).filter((s): s is CaptureSource => (CAPTURE_SOURCES as readonly string[]).includes(s)),
    authors: by.filter((a) => /^[0-9a-f-]{36}$/i.test(a)),
    link: p.get('link'),
  };
}

export function filtersToParams(f: GridFilters, base: { toString(): string } = ''): URLSearchParams {
  const p = new URLSearchParams(base.toString());
  for (const k of ['type', 'source', 'by', 'link']) p.delete(k);
  if (f.types.length) p.set('type', f.types.join(','));
  if (f.sources.length) p.set('source', f.sources.join(','));
  if (f.authors.length) p.set('by', f.authors.join(','));
  if (f.link) p.set('link', f.link);
  return p;
}

/** API kinds for the chosen type filters. */
export function kindsOf(types: TypeFilter[]): RecordingKind[] {
  return TYPE_FILTERS.filter((t) => types.includes(t.value)).flatMap((t) => [...t.kinds]);
}

export const isKind = (k: string): k is RecordingKind => (RECORDING_KINDS as readonly string[]).includes(k);

// ---------- linked issues (J-241) ----------

export interface IssueRef {
  tracker: 'github' | 'gitlab' | 'other';
  url: string | null;
  /** "org/repo#12" or "group/project#3" */
  key: string;
}

const GH_URL = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/gi;
const GL_URL = /https?:\/\/gitlab\.[\w.-]+\/([\w./-]+?)\/-\/(?:issues|merge_requests)\/(\d+)/gi;
const SHORT = /(?<![\w/.-])([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g;

/** Issue references in free text: GitHub and GitLab URLs and "org/repo#12" keys. Deduped by key. */
export function parseIssueRefs(text: string): IssueRef[] {
  const out = new Map<string, IssueRef>();
  for (const m of text.matchAll(GH_URL)) out.set(`${m[1]}#${m[2]}`, { tracker: 'github', url: m[0], key: `${m[1]}#${m[2]}` });
  for (const m of text.matchAll(GL_URL)) out.set(`${m[1]}#${m[2]}`, { tracker: 'gitlab', url: m[0], key: `${m[1]}#${m[2]}` });
  const stripped = text.replace(GH_URL, ' ').replace(GL_URL, ' ');
  for (const m of stripped.matchAll(SHORT)) {
    const key = `${m[1]}#${m[2]}`;
    if (!out.has(key)) out.set(key, { tracker: 'other', url: null, key });
  }
  return [...out.values()];
}

/** Tracker and key of a ticket URL on a recording link (J-241). */
export function refOfUrl(url: string): { url: string; tracker: string; key: string | null } {
  const [r] = parseIssueRefs(url);
  if (r && r.url) return { url, tracker: r.tracker, key: r.key };
  let host = 'other';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* keep other */
  }
  const num = url.match(/(\d+)(?:\/?$|[?#])/);
  return { url, tracker: host, key: num ? `#${num[1]}` : null };
}

// ---------- small formatting helpers shared by dashboard views ----------

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function relativeTime(iso: string | Date, now = Date.now()): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString('en', { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** 65000 -> "1:05". */
export function durationLabel(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Title shown on a card when the capture has none (J-158): based on the creator. */
export function fallbackTitle(c: { title: string; authorName: string | null; kind: RecordingKind; recordingLinkName?: string | null }): string {
  if (c.title.trim()) return c.title;
  const who = c.authorName?.split(' ')[0] ?? (c.recordingLinkName ? 'A guest' : 'Someone');
  const what = c.kind === 'screenshot' ? 'screenshot' : c.kind === 'replay' ? 'replay' : c.kind === 'trace' ? 'trace' : 'recording';
  return `${who}'s ${what}`;
}

/** Four-character folder id alphabet (J-162). */
export const SHORT_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Onboarding checklist steps (J-169), in order. */
export const ONBOARDING_STEPS = [
  { id: 'extension', label: 'Install the extension', href: '/settings/browsers' },
  { id: 'capture', label: 'Make your first capture', href: '/' },
  { id: 'invite', label: 'Invite your team', href: '/settings/members' },
  { id: 'integration', label: 'Connect an app', href: '/settings/integrations' },
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]['id'];
