// The body of a filed tracker issue or Slack post (J-242): title, description, console errors,
// failing requests, URL, time, locale and zone, device, OS, browser, viewport, connection speed
// and the capture link. Pure functions over the capture row and its events.
import { gunzipSync } from 'node:zlib';
import type { CaptureEvent } from '@toolbar/shared';
import { getBytes, keys } from '../s3.ts';

export interface IssueSource {
  id: string;
  title: string;
  description: string;
  pageUrl: string | null;
  createdAt: Date;
  env: Record<string, unknown> | null;
  authorName: string | null;
}

export interface Signals {
  consoleErrors: { message: string; count: number }[];
  failedRequests: { method: string; url: string; status: number | null; error: string | null }[];
}

const argText = (a: unknown): string => {
  if (a === null || a === undefined) return String(a);
  if (typeof a === 'string') return a;
  if (typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if (typeof o.message === 'string') return `${o.name ?? 'Error'}: ${o.message}`;
    if (typeof o.v === 'string') return o.v;
    try {
      return JSON.stringify(a).slice(0, 200);
    } catch {
      return '[object]';
    }
  }
  return String(a);
};

/** Console errors (deduplicated, counted) and failed requests from the event list. */
export function signalsOf(events: CaptureEvent[]): Signals {
  const errs = new Map<string, number>();
  const add = (m: string) => errs.set(m, (errs.get(m) ?? 0) + 1);
  const reqs = new Map<string, { method: string; url: string; status: number | null; error: string | null }>();
  const failed: Signals['failedRequests'] = [];
  for (const e of events) {
    if (e.kind === 'console' && (e.data as { level: string }).level === 'error') {
      add(((e.data as { args: unknown[] }).args ?? []).map(argText).join(' ').slice(0, 300) || 'console.error');
    } else if (e.kind === 'error') {
      const d = e.data as { name?: string; message: string };
      add(`${d.name ? d.name + ': ' : ''}${d.message}`.slice(0, 300));
    } else if (e.kind === 'net.req') {
      const d = e.data as { rid: string; method: string; url: string };
      reqs.set(d.rid, { method: d.method, url: d.url, status: null, error: null });
    } else if (e.kind === 'net.res') {
      const d = e.data as { rid: string; status: number };
      const r = reqs.get(d.rid);
      if (r && d.status >= 400) failed.push({ ...r, status: d.status });
    } else if (e.kind === 'net.fail') {
      const d = e.data as { rid: string; error: string };
      const r = reqs.get(d.rid);
      if (r) failed.push({ ...r, error: d.error });
    }
  }
  const seen = new Set<string>();
  return {
    consoleErrors: [...errs].map(([message, count]) => ({ message, count })).slice(0, 10),
    failedRequests: failed.filter((f) => {
      const k = `${f.method} ${f.url} ${f.status}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 10),
  };
}

export async function loadSignals(recId: string): Promise<Signals> {
  try {
    const gz = await getBytes(keys.final(recId, 'events.json.gz'));
    return signalsOf(JSON.parse(gunzipSync(gz).toString('utf8')) as CaptureEvent[]);
  } catch {
    return { consoleErrors: [], failedRequests: [] };
  }
}

export function envLines(env: Record<string, unknown> | null): [string, string][] {
  if (!env) return [];
  const e = env as {
    browser?: { name: string; version: string };
    os?: { name: string; version?: string };
    platform?: string;
    viewport?: { w: number; h: number };
    dpr?: number;
    locale?: string;
    tz?: string;
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
    ua?: string;
  };
  const out: [string, string][] = [];
  if (e.browser) out.push(['Browser', `${e.browser.name} ${e.browser.version}`]);
  if (e.os) out.push(['OS', `${e.os.name}${e.os.version ? ' ' + e.os.version : ''}`]);
  else if (e.platform) out.push(['OS', e.platform]);
  out.push(['Device', /Mobi|Android|iPhone|iPad/i.test(e.ua ?? '') ? 'Mobile' : 'Desktop']);
  if (e.viewport) out.push(['Viewport', `${e.viewport.w} x ${e.viewport.h}${e.dpr ? ` @${e.dpr}x` : ''}`]);
  if (e.locale || e.tz) out.push(['Locale and zone', [e.locale, e.tz].filter(Boolean).join(', ')]);
  if (e.connection?.effectiveType || e.connection?.downlink)
    out.push(['Network speed', [e.connection.effectiveType, e.connection.downlink ? `${e.connection.downlink} Mbps` : null].filter(Boolean).join(', ')]);
  return out;
}

/** Markdown body for GitHub and GitLab issues. */
export function issueMarkdown(src: IssueSource, s: Signals, captureUrl: string): string {
  const parts: string[] = [];
  if (src.description.trim()) parts.push(src.description.trim());
  parts.push(`**Capture:** ${captureUrl}`);
  const meta: [string, string][] = [];
  if (src.pageUrl) meta.push(['URL', src.pageUrl]);
  meta.push(['Time', src.createdAt.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')]);
  if (src.authorName) meta.push(['Reported by', src.authorName]);
  meta.push(...envLines(src.env));
  parts.push(['| | |', '|---|---|', ...meta.map(([k, v]) => `| ${k} | ${v.replace(/\|/g, '\\|')} |`)].join('\n'));
  if (s.consoleErrors.length)
    parts.push(['### Console errors', '```', ...s.consoleErrors.map((c) => (c.count > 1 ? `${c.message} (x${c.count})` : c.message)), '```'].join('\n'));
  if (s.failedRequests.length)
    parts.push(['### Failing requests', ...s.failedRequests.map((r) => `- \`${r.method} ${r.url}\` ${r.status ?? r.error ?? ''}`)].join('\n'));
  parts.push(`Open the capture for the video, full console, network with headers and bodies, and user actions: ${captureUrl}`);
  return parts.join('\n\n');
}

/** Plain text for a Slack incoming webhook (mrkdwn). */
export function slackText(src: IssueSource, s: Signals, captureUrl: string, message?: string): string {
  const lines = [`*<${captureUrl}|${src.title || 'New capture'}>*`];
  if (message?.trim()) lines.push(message.trim());
  if (src.description.trim()) lines.push(src.description.trim().slice(0, 600));
  if (src.pageUrl) lines.push(`URL: ${src.pageUrl}`);
  const env = envLines(src.env);
  if (env.length) lines.push(env.map(([k, v]) => `${k}: ${v}`).join(' | '));
  if (s.consoleErrors.length) lines.push(`Console errors: ${s.consoleErrors.length}`);
  if (s.failedRequests.length) lines.push(`Failing requests: ${s.failedRequests.map((r) => `${r.method} ${r.url} ${r.status ?? r.error}`).slice(0, 3).join(', ')}`);
  return lines.join('\n');
}
