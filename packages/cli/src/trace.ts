// Turn a Playwright trace archive into capture events (J-245): console, page errors, network with
// headers and small text bodies, navigations, and the test's actions as user events, with
// password, one-time-code and card fields masked. Times map from the trace's monotonic clock to
// epoch ms through the context's wallTime.
import type { CaptureEvent, EnvInfo, EventDataMap, EventKind, TargetRef } from '@toolbar/shared/events';
import { readZip } from './zip.ts';

type Json = Record<string, unknown>;

const SECRET_FIELD = /pass(word)?|pwd|otp|one-?time|2fa|totp|verification.?code|card|cc-?(num|number|csc|exp)|cvc|cvv|security.?code|secret|token/i;
const SECRET_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|.*(token|secret).*)$/i;
const TEXT_TYPES = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded|graphql)|[^;]*\+json)/i;
const BODY_CAP = 64 * 1024;

export interface TraceResult {
  events: CaptureEvent[];
  /** epoch ms of the first page or context start (the video's zero) */
  startedAt: number;
  endedAt: number;
  firstUrl: string | null;
  title: string | null;
  env: EnvInfo;
  stats: { console: number; errors: number; requests: number; actions: number };
}

function lines(buf: Buffer | undefined): Json[] {
  if (!buf) return [];
  return buf
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as Json;
      } catch {
        return null;
      }
    })
    .filter((x): x is Json => !!x);
}

const headersOf = (arr: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const h of (arr as { name: string; value: string }[] | undefined) ?? []) {
    const k = h.name.toLowerCase();
    out[k] = SECRET_HEADER.test(k) ? '[redacted]' : h.value;
  }
  return out;
};

/** Target description from a Playwright selector, for the actions list. */
function targetOf(selector: string | undefined): TargetRef | undefined {
  if (!selector) return undefined;
  const testId = /internal:testid=\[data-testid="([^"]+)"/.exec(selector)?.[1] ?? /data-testid=["']?([\w-]+)/.exec(selector)?.[1];
  const role = /internal:role=(\w+)/.exec(selector)?.[1];
  const name = /\[name="([^"]+)"/.exec(selector)?.[1] ?? /internal:label="([^"]+)"/.exec(selector)?.[1];
  const text = /internal:text="([^"]+)"/.exec(selector)?.[1];
  return {
    selector,
    tag: role === 'button' ? 'button' : role === 'link' ? 'a' : role === 'textbox' ? 'input' : 'element',
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(text ? { text } : {}),
    ...(testId ? { testId } : {}),
    rect: { x: 0, y: 0, w: 0, h: 0 },
  };
}

export function parseTrace(zip: Buffer): TraceResult {
  const files = readZip(zip);
  const traceFiles = [...files.keys()].filter((k) => /(^|\/)[^/]*\.trace$/.test(k)).sort();
  const netFiles = [...files.keys()].filter((k) => /(^|\/)[^/]*\.network$/.test(k)).sort();
  if (!traceFiles.length) throw new Error('No .trace file in the archive: is this a Playwright trace?');
  const entries = traceFiles.flatMap((k) => lines(files.get(k)));
  const net = netFiles.flatMap((k) => lines(files.get(k)));

  const ctx = entries.find((e) => e.type === 'context-options') ?? {};
  const wall = Number(ctx.wallTime ?? Date.now());
  const mono = Number(ctx.monotonicTime ?? 0);
  const at = (t: unknown) => wall + (Number(t) - mono);
  const opts = (ctx.options ?? {}) as { viewport?: { width: number; height: number }; userAgent?: string; locale?: string; timezoneId?: string; deviceScaleFactor?: number };

  const out: CaptureEvent[] = [];
  const seqs = new Map<string, number>();
  const emit = <K extends EventKind>(t: number, kind: K, data: EventDataMap[K], ctxName = 'top') => {
    const seq = seqs.get(ctxName) ?? 0;
    seqs.set(ctxName, seq + 1);
    out.push({ v: 1, id: `${ctxName}:${seq}`, ctx: ctxName, seq, t, kind, data } as CaptureEvent);
  };
  const stats = { console: 0, errors: 0, requests: 0, actions: 0 };

  // the video starts with the first page
  const pageStart = entries.find((e) => e.type === 'event' && e.method === 'page') ?? entries.find((e) => e.type === 'before');
  const startedAt = pageStart ? at(pageStart.time ?? pageStart.startTime) : wall;
  let firstUrl: string | null = null;
  let title: string | null = typeof ctx.title === 'string' ? ctx.title : null;

  const env: EnvInfo = {
    ua: opts.userAgent ?? `Playwright ${String(ctx.playwrightVersion ?? '')} ${String(ctx.browserName ?? 'chromium')}`.trim(),
    browser: { name: String(ctx.browserName ?? 'chromium'), version: String(ctx.playwrightVersion ?? '') },
    os: { name: String(ctx.platform ?? process.platform) },
    viewport: { w: opts.viewport?.width ?? 1280, h: opts.viewport?.height ?? 720 },
    dpr: opts.deviceScaleFactor ?? 1,
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(opts.timezoneId ? { tz: opts.timezoneId } : {}),
    maskingPreset: 'staging',
  };
  emit(startedAt, 'env', env, 'sw');
  emit(startedAt, 'media', { stream: 'video', op: 'start', mime: 'video/webm' }, 'off');

  const befores = new Map<string, Json>();
  for (const e of entries) {
    if (e.type === 'before') {
      befores.set(String(e.callId), e);
      const method = String(e.method ?? '');
      const params = (e.params ?? {}) as Json;
      const t = at(e.startTime);
      const selector = typeof params.selector === 'string' ? params.selector : undefined;
      if (method === 'goto' && typeof params.url === 'string') {
        firstUrl ??= params.url;
        emit(t, 'nav', { type: 'load', url: params.url });
      } else if (method === 'click' || method === 'dblclick' || method === 'tap' || method === 'check' || method === 'uncheck') {
        stats.actions++;
        emit(t, 'user', { type: method === 'dblclick' ? 'dblclick' : 'click', target: targetOf(selector) });
      } else if (method === 'fill' || method === 'type' || method === 'pressSequentially' || method === 'selectOption') {
        stats.actions++;
        const value = String(params.value ?? params.text ?? (Array.isArray(params.options) ? JSON.stringify(params.options) : ''));
        const masked = SECRET_FIELD.test(selector ?? '');
        emit(t, 'user', { type: method === 'selectOption' ? 'select' : 'input', target: targetOf(selector), ...(masked ? { masked: true, value: '*'.repeat(Math.min(12, value.length)) } : { value }) });
      } else if (method === 'press' || method === 'keyboardPress') {
        stats.actions++;
        emit(t, 'user', { type: 'key', key: String(params.key ?? ''), target: targetOf(selector) });
      }
    } else if (e.type === 'console') {
      stats.console++;
      const lvl = String(e.messageType ?? 'log');
      const level = (['log', 'info', 'warn', 'error', 'debug'].includes(lvl) ? lvl : lvl === 'warning' ? 'warn' : 'log') as 'log';
      const loc = e.location as { url?: string; lineNumber?: number; columnNumber?: number } | undefined;
      emit(at(e.time), 'console', {
        level,
        args: [String(e.text ?? '')],
        ...(loc?.url ? { stack: `    at ${loc.url}:${(loc.lineNumber ?? 0) + 1}:${(loc.columnNumber ?? 0) + 1}` } : {}),
      });
    } else if (e.type === 'event' && e.method === 'pageError') {
      stats.errors++;
      const err = ((e.params as Json)?.error as Json)?.error as { message?: string; name?: string; stack?: string } | undefined;
      emit(at(e.time), 'error', { type: 'error', message: err?.message ?? 'Page error', ...(err?.name ? { name: err.name } : {}), ...(err?.stack ? { stack: err.stack } : {}) });
    } else if (e.type === 'event' && e.method === 'navigated') {
      const url = String((e.params as Json)?.url ?? '');
      if (url) emit(at(e.time), 'nav', { type: 'load', url });
    } else if (e.type === 'after' && e.error) {
      const b = befores.get(String(e.callId));
      emit(at(e.endTime), 'console', { level: 'error', args: [`Test step ${String(b?.apiName ?? b?.method ?? '')} failed: ${String((e.error as Json).message ?? '')}`] });
    } else if (e.type === 'frame-snapshot' && !title) {
      const snap = e.snapshot as { frameUrl?: string; html?: unknown } | undefined;
      if (snap?.frameUrl) firstUrl ??= snap.frameUrl;
    }
  }

  let rid = 0;
  for (const n of net) {
    if (n.type !== 'resource-snapshot') continue;
    const s = n.snapshot as Json;
    const req = s.request as { method: string; url: string; headers: unknown; postData?: { text?: string; mimeType?: string } };
    const res = s.response as { status: number; statusText: string; headers: unknown; content?: { mimeType?: string; size?: number; _sha1?: string; _file?: string; text?: string } } | undefined;
    if (!req?.url || /^data:/.test(req.url)) continue;
    stats.requests++;
    const id = `pw-${rid++}`;
    const start = s._monotonicTime !== undefined ? at(s._monotonicTime) : Date.parse(String(s.startedDateTime));
    const dur = Number(s.time ?? 0);
    const reqBody = req.postData?.text;
    emit(start, 'net.req', {
      rid: id,
      method: req.method,
      url: req.url,
      headers: headersOf(req.headers),
      ...(reqBody ? { body: SECRET_FIELD.test(reqBody) ? '[redacted]' : reqBody.slice(0, BODY_CAP) } : {}),
      initiator: String(s._resourceType ?? '') === 'document' ? 'document' : 'fetch',
      source: 'page',
    });
    if (!res || res.status <= 0) {
      emit(start + Math.max(1, dur), 'net.fail', { rid: id, error: String((s as Json)._failureText ?? 'net::ERR_FAILED') });
      continue;
    }
    const ct = res.content?.mimeType ?? '';
    let body: string | undefined;
    if (TEXT_TYPES.test(ct)) {
      const ref = res.content?._file ?? (res.content?._sha1 ? `resources/${res.content._sha1}` : null);
      const file = ref ? (files.get(ref) ?? files.get(`resources/${ref}`) ?? null) : null;
      const text = file?.toString('utf8') ?? res.content?.text;
      if (text) body = text.slice(0, BODY_CAP);
    }
    emit(start + Math.max(1, dur), 'net.res', {
      rid: id,
      status: res.status,
      statusText: res.statusText,
      headers: headersOf(res.headers),
      ...(body !== undefined ? { body, truncated: body.length >= BODY_CAP } : {}),
      contentType: ct || undefined,
      encodedSize: res.content?.size,
      timing: { start, end: start + dur },
    });
  }

  out.sort((a, b) => a.t - b.t || a.seq - b.seq);
  const endedAt = Math.max(startedAt, ...out.map((e) => e.t));
  emit(endedAt, 'media', { stream: 'video', op: 'stop' }, 'off');
  if (!title && firstUrl) title = null;
  return { events: out, startedAt, endedAt, firstUrl, title, env, stats };
}
