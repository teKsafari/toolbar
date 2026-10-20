// Text an agent reads: signal counts, the markdown summary behind a share link (J-153), the
// investigation guide that follows the details tool (J-149), the agent-tab prompts (J-152) and
// the copy-for-AI text. Pure functions over a capture brief and its prepared events.
import type { EnvInfo } from '../events.ts';
import { PRODUCT_NAME } from '../constants.ts';
import { isFailed } from './panels.ts';
import type { Prepared } from './query.ts';
import { fmtClock } from './format.ts';

export interface BriefComment {
  author: string;
  body: string;
  /** playback time, ms */
  tMs: number | null;
  createdAt: string;
  replies?: BriefComment[];
}

/** What the summaries need to know about a capture, independent of where it came from. */
export interface CaptureBrief {
  id: string;
  title: string;
  description: string;
  kind: string;
  status: string;
  /** link the reader should open: the share URL for link holders, else the member URL */
  url: string;
  pageUrl: string | null;
  pageTitle: string | null;
  createdAt: string;
  durationMs: number | null;
  /** verified false: an embed reviewer's typed name, shown with " (embed)" (D-213) */
  author: { name: string | null; email: string | null; verified?: boolean } | null;
  env: EnvInfo | null;
  folder: string | null;
  /** public poster or screenshot URL, when the reader may fetch it */
  imageUrl: string | null;
  comments: BriefComment[];
  transcript: { status: string; text: string | null } | null;
  metadata?: Record<string, unknown> | null;
  /** project and masking preset of the capture (D-123, D-125) */
  project?: string | null;
  maskingPreset?: string | null;
}

export interface Signals {
  consoleErrors: number;
  consoleWarnings: number;
  uncaughtErrors: number;
  failedRequests: number;
  serverErrors: number;
  clientErrors: number;
  pendingRequests: number;
  interactions: number;
  navigations: number;
}

export function signalsOf(p: Prepared): Signals {
  const http = p.network.filter((n) => n.type !== 'websocket' && n.type !== 'eventsource');
  return {
    consoleErrors: p.console.filter((r) => r.kind === 'console' && r.level === 'error').length,
    consoleWarnings: p.console.filter((r) => r.kind === 'console' && r.level === 'warn').length,
    uncaughtErrors: p.console.filter((r) => r.kind === 'error').length,
    failedRequests: http.filter((n) => isFailed(n)).length,
    serverErrors: http.filter((n) => n.status !== null && n.status >= 500).length,
    clientErrors: http.filter((n) => n.status !== null && n.status >= 400 && n.status < 500).length,
    pendingRequests: http.filter((n) => n.state === 'pending').length,
    interactions: p.actions.filter((a) => a.type !== 'navigation' && a.type !== 'visibility').length,
    navigations: p.actions.filter((a) => a.type === 'navigation').length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function signalsLine(s: Signals): string {
  return [
    plural(s.consoleErrors + s.uncaughtErrors, 'console error'),
    plural(s.failedRequests, 'failed request'),
    `${s.serverErrors} with a 5xx status`,
    plural(s.pendingRequests, 'request', 'requests') + ' never answered',
    plural(s.interactions, 'interaction'),
  ].join(', ');
}

const yaml = (v: unknown) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(String(v)));

function browserOf(env: EnvInfo | null): string | null {
  if (!env?.browser) return null;
  return `${env.browser.name} ${env.browser.version}`.trim();
}
function osOf(env: EnvInfo | null): string | null {
  if (!env?.os) return env?.platform ?? null;
  return [env.os.name, env.os.version].filter(Boolean).join(' ');
}

function commentLines(cs: BriefComment[], indent = ''): string[] {
  const outLines: string[] = [];
  for (const c of cs) {
    const at = c.tMs !== null ? ` at ${fmtClock(c.tMs)}` : '';
    const body = c.body.replace(/@\[([^\]]{1,80})\]\(user:[0-9a-f-]{36}\)/g, '@$1').replace(/\n+/g, ' ').trim();
    outLines.push(`${indent}- **${c.author}** (${c.createdAt}${at}): ${body}`);
    if (c.replies?.length) outLines.push(...commentLines(c.replies, indent + '  '));
  }
  return outLines;
}

export interface Pointers {
  /** MCP server URL, e.g. https://toolbar.example/mcp */
  mcpUrl: string;
  /** base of the HTTP API, e.g. https://toolbar.example/api/v1; omitted: no API line */
  apiUrl?: string | null;
  /** name of the CLI binary; null or omitted while the CLI is paused (docs/scope.md, FEATURE_CLI) */
  cli?: string | null;
}

/** Markdown for `curl <share url>.md` or `Accept: text/markdown` (J-153). About 1 KB plus comments. */
export function shareMarkdown(b: CaptureBrief, s: Signals | null, ptr: Pointers): string {
  const env = b.env;
  const fm = [
    '---',
    `title: ${yaml(b.title || 'Untitled capture')}`,
    `url: ${yaml(b.url)}`,
    `type: ${yaml(b.kind)}`,
    `captured_on: ${yaml(b.pageUrl)}`,
    `page_title: ${yaml(b.pageTitle)}`,
    `image: ${yaml(b.imageUrl)}`,
    `duration_ms: ${yaml(b.durationMs)}`,
    `browser: ${yaml(browserOf(env))}`,
    `os: ${yaml(osOf(env))}`,
    `viewport: ${yaml(env ? `${env.viewport.w}x${env.viewport.h}` : null)}`,
    `screen: ${yaml(env?.screen ? `${env.screen.w}x${env.screen.h}` : null)}`,
    `time_zone: ${yaml(env?.tz)}`,
    `locale: ${yaml(env?.locale)}`,
    `author: ${yaml(b.author?.name ?? null)}`,
    ...(b.author?.verified === false ? ['author_verified: false'] : []),
    `created: ${yaml(b.createdAt)}`,
    ...(b.project ? [`project: ${yaml(b.project)}`] : []),
    ...(b.maskingPreset ? [`masking_preset: ${yaml(b.maskingPreset)}`] : []),
    '---',
  ];
  const body: string[] = ['', `# ${b.title || 'Untitled capture'}`, ''];
  if (b.description.trim()) body.push(b.description.trim(), '');
  if (s) body.push(`Signals: ${signalsLine(s)}.`, '');
  else body.push('Signals: this capture is still processing.', '');
  if (b.comments.length) {
    body.push(`## Comments (${b.comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0)})`, '', ...commentLines(b.comments), '');
  }
  body.push(
    '## More detail',
    '',
    `This page is a short summary. The full console, network (with headers and bodies), user events, frames and transcript are available to coding agents:`,
    '',
    `- MCP server: ${ptr.mcpUrl} (call \`get_capture\` with this capture's URL first)`,
  );
  if (ptr.apiUrl)
    body.push(`- HTTP API: \`GET ${ptr.apiUrl}/recordings/${b.id}/console\`, then \`/network\`, \`/actions\` and \`/frames\`, with a personal token (Settings, API tokens)`);
  if (ptr.cli) body.push(`- CLI: \`${ptr.cli} get ${b.url}\`, then \`${ptr.cli} console\`, \`${ptr.cli} network\` and \`${ptr.cli} frames\``);
  body.push('');
  return fm.join('\n') + '\n' + body.join('\n');
}

/**
 * Ranked next calls after get_capture (J-149): failures first, with pre-filled filters, so the
 * agent's second call already narrows to what went wrong.
 */
export function investigationGuide(b: CaptureBrief, p: Prepared | null, s: Signals | null): string {
  const lines: string[] = ['## How to investigate this capture', ''];
  if (!p || !s) {
    lines.push(`Status is ${b.status}: events are not ready yet. Call get_capture again in a few seconds.`);
    return lines.join('\n');
  }
  const errs = s.consoleErrors + s.uncaughtErrors;
  lines.push(`Headline: ${signalsLine(s)}.`, '');
  const steps: string[] = [];
  const firstFail = p.network.find((n) => isFailed(n) && n.type !== 'websocket' && n.type !== 'eventsource');
  if (s.serverErrors || s.clientErrors || s.failedRequests) {
    const at = firstFail ? ` The first one is ${firstFail.method} ${firstFail.path} at ${fmtClock(firstFail.at)}${firstFail.status ? ` (${firstFail.status})` : ''}.` : '';
    steps.push(`get_network_requests with status ["4xx","5xx","failed"]: read the response bodies of the failed calls.${at}`);
  }
  if (errs) steps.push(`get_console_logs with levels ["error"]: uncaught errors come with a stack and the source line.`);
  if (s.pendingRequests) steps.push(`get_network_requests with status ["pending"]: ${plural(s.pendingRequests, 'request')} never got an answer.`);
  if (s.interactions) steps.push('get_user_events: what the person clicked and typed before the failure (passwords are masked).');
  const firstErrAt = p.console.find((r) => r.level === 'error')?.at ?? firstFail?.at;
  if (b.kind === 'video' || b.kind === 'screen') {
    steps.push(firstErrAt !== undefined ? `get_frames with at [${Math.max(0, Math.round(firstErrAt))}]: see the screen at the first failure.` : 'get_frames with no times: a 4x3 overview of the video.');
  } else if (b.kind === 'screenshot') {
    steps.push('get_screenshots: the image the person marked up.');
  }
  if (b.transcript?.status === 'done') steps.push('get_transcript: what the person said while recording.');
  if (b.comments.length) steps.push('list_comments: the discussion on this capture.');
  steps.push('When you have fixed it, create_comment on this capture with the cause and the fix.');
  steps.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  return lines.join('\n');
}

/** Prompts for the agent tab (J-152): setup before a client connects, then three presets. */
export function agentPrompts(captureUrl: string, mcpUrl: string) {
  return {
    setup: `Add the ${PRODUCT_NAME} MCP server to your tools: it is a streamable HTTP server at ${mcpUrl}. Sign in when the browser asks. Then open this capture with get_capture: ${captureUrl}`,
    fix: `Use the ${PRODUCT_NAME} MCP tools to investigate ${captureUrl}. Find the root cause from its console, network and user events, fix it in this codebase, then leave a comment on the capture that says what caused it and what you changed.`,
    summarize: `Use the ${PRODUCT_NAME} MCP tools to read ${captureUrl} and write a short summary: what the person tried, what went wrong (with times), and the errors and failed requests involved.`,
    e2e: `Use the ${PRODUCT_NAME} MCP tools to read the user events and network calls in ${captureUrl}, then write an end-to-end test (Playwright) that repeats those steps and fails on the bug it shows.`,
  };
}

/** Plain markdown bundle for the copy-for-AI button: the summary plus the failing rows inline. */
export function copyForAi(b: CaptureBrief, p: Prepared | null, ptr: Pointers): string {
  const s = p ? signalsOf(p) : null;
  const parts = [shareMarkdown(b, s, ptr).trimEnd()];
  if (p) {
    const errs = p.console.filter((r) => r.level === 'error').slice(0, 15);
    if (errs.length) {
      parts.push('', '## Errors', '');
      for (const e of errs) {
        parts.push(`- [${fmtClock(e.at)}] ${e.message}`);
        if (e.source) parts.push(`  at ${e.source.fn ? e.source.fn + ' ' : ''}${e.source.url}:${e.source.line}:${e.source.col}`);
      }
    }
    const fails = p.network.filter((n) => isFailed(n) && n.type !== 'websocket' && n.type !== 'eventsource').slice(0, 15);
    if (fails.length) {
      parts.push('', '## Failed requests', '');
      for (const n of fails) {
        parts.push(`- [${fmtClock(n.at)}] ${n.method} ${n.url} -> ${n.status ?? n.error ?? 'failed'}`);
        if (n.responseBody) parts.push('  ```', `  ${n.responseBody.slice(0, 600).replace(/\n/g, '\n  ')}`, '  ```');
      }
    }
    const pend = p.network.filter((n) => n.state === 'pending' && n.type !== 'websocket' && n.type !== 'eventsource');
    if (pend.length) {
      parts.push('', '## Requests that never answered', '');
      for (const n of pend.slice(0, 10)) parts.push(`- [${fmtClock(n.at)}] ${n.method} ${n.url}`);
    }
    const steps = p.actions.filter((a) => a.type !== 'visibility').slice(0, 30);
    if (steps.length) {
      parts.push('', '## Steps', '');
      for (const a of steps) {
        const what =
          a.type === 'navigation'
            ? `navigate to ${a.url}`
            : a.type === 'input'
              ? `type ${a.masked ? '(masked)' : JSON.stringify(a.value ?? '')} into ${a.target?.selector ?? 'a field'}`
              : a.type === 'key'
                ? `press ${a.key}`
                : `${a.type} ${a.target?.selector ?? ''}${a.target?.text ? ` "${a.target.text.slice(0, 60)}"` : ''}`;
        parts.push(`${steps.indexOf(a) + 1}. [${fmtClock(a.at)}] ${what}`);
      }
    }
  }
  return parts.join('\n') + '\n';
}
