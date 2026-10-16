import type { Browser } from 'wxt/browser';
// chrome.webRequest metadata (architecture s10): what the page hooks cannot see. Documents,
// scripts, styles, fonts, images, media, beacons, full request headers (cookies included,
// then redacted), cache hits, net::ERR_* failures, timing, and a CORS call-out (J-065).
// Requests the extension makes itself never enter a capture (J-248).
import type { CaptureEvent, NetInitiator } from '@toolbar/shared';

type Details = {
  requestId: string;
  url: string;
  method: string;
  tabId: number;
  frameId: number;
  type: string;
  timeStamp: number;
  initiator?: string;
  requestHeaders?: { name: string; value?: string }[];
  responseHeaders?: { name: string; value?: string }[];
  statusCode?: number;
  statusLine?: string;
  fromCache?: boolean;
  error?: string;
  ip?: string;
};

export const TYPE_MAP: Record<string, NetInitiator> = {
  main_frame: 'document',
  sub_frame: 'subdocument',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'other',
  xmlhttprequest: 'fetch',
  ping: 'ping',
  csp_report: 'other',
  media: 'media',
  websocket: 'websocket',
  webbundle: 'other',
  other: 'other',
};

const toRecord = (h?: { name: string; value?: string }[]) => {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  for (const { name, value } of h) out[name.toLowerCase()] = value ?? '';
  return out;
};

/** Cross-origin fetch/XHR whose response does not allow the initiating origin. */
export function isCorsBlocked(d: { type: string; url: string; initiator?: string; responseHeaders?: { name: string; value?: string }[] }): boolean {
  if (d.type !== 'xmlhttprequest' || !d.initiator || d.initiator === 'null') return false;
  let target: string;
  try {
    target = new URL(d.url).origin;
  } catch {
    return false;
  }
  if (target === d.initiator) return false;
  const allow = d.responseHeaders?.find((h) => h.name.toLowerCase() === 'access-control-allow-origin')?.value?.trim();
  return !allow || (allow !== '*' && allow !== d.initiator);
}

export interface WebRequestSink {
  /**
   * Requests to record; others are ignored (closed tabs, the extension's own pages, and tabs whose
   * page is out of the scope, D-202). Called first for each request, so a main_frame request can
   * note the tab's new page.
   */
  wants(tabId: number, req: { url: string; type: string }): boolean;
  emit(tabId: number, e: Omit<CaptureEvent, 'v' | 'id' | 'ctx' | 'seq'>): void;
  /** URL prefixes that belong to the extension and must never be recorded (J-248). */
  ownPrefixes(): string[];
}

/** Installs the listeners and returns a function that removes them. */
export function installWebRequest(wr: typeof Browser.webRequest, sink: WebRequestSink): () => void {
  const filter = { urls: ['<all_urls>'] };
  const open = new Map<string, { start: number; ttfb?: number; tabId: number; headers?: { name: string; value?: string }[]; status?: number; statusLine?: string }>();
  const own = (d: Details) => {
    if (d.tabId < 0) return true;
    if (d.initiator?.startsWith('chrome-extension://')) return true;
    return sink.ownPrefixes().some((p) => d.url.startsWith(p));
  };
  const rid = (d: Details) => `wr-${d.requestId}`;

  const onSend = (d: Details) => {
    if (own(d) || !sink.wants(d.tabId, { url: d.url, type: d.type })) return;
    open.set(d.requestId, { start: d.timeStamp, tabId: d.tabId });
    sink.emit(d.tabId, {
      t: d.timeStamp,
      kind: 'net.req',
      data: {
        rid: rid(d),
        method: d.method,
        url: d.url,
        headers: toRecord(d.requestHeaders),
        initiator: TYPE_MAP[d.type] ?? 'other',
        source: 'webRequest',
        frameId: d.frameId,
        ...(d.initiator ? { origin: d.initiator } : {}),
      },
    } as Omit<CaptureEvent, 'v' | 'id' | 'ctx' | 'seq'>);
  };
  const onStarted = (d: Details) => {
    const o = open.get(d.requestId);
    if (o) o.ttfb = d.timeStamp - o.start;
  };
  const onCompleted = (d: Details) => {
    const o = open.get(d.requestId);
    if (!o) return;
    open.delete(d.requestId);
    const headers = toRecord(d.responseHeaders);
    const len = Number(headers?.['content-length']);
    const statusText = d.statusLine?.replace(/^HTTP\/[\d.]+\s+\d+\s*/, '') || undefined;
    sink.emit(o.tabId, {
      t: d.timeStamp,
      kind: 'net.res',
      data: {
        rid: rid(d),
        status: d.statusCode ?? 0,
        ...(statusText ? { statusText } : {}),
        headers,
        ...(headers?.['content-type'] ? { contentType: headers['content-type'] } : {}),
        ...(Number.isFinite(len) ? { encodedSize: len } : {}),
        timing: { start: o.start, ...(o.ttfb !== undefined ? { ttfb: Math.round(o.ttfb * 100) / 100 } : {}), end: d.timeStamp },
        source: 'webRequest',
        ...(d.fromCache ? { fromCache: true } : {}),
      },
    } as Omit<CaptureEvent, 'v' | 'id' | 'ctx' | 'seq'>);
    if (isCorsBlocked(d)) sink.emit(o.tabId, { t: d.timeStamp, kind: 'net.fail', data: { rid: rid(d), error: 'cors', cors: true, source: 'webRequest' } } as Omit<CaptureEvent, 'v' | 'id' | 'ctx' | 'seq'>);
  };
  const onHeaders = (d: Details) => {
    const o = open.get(d.requestId);
    if (!o) return;
    o.headers = d.responseHeaders;
    o.status = d.statusCode;
    o.statusLine = d.statusLine;
  };
  const onError = (d: Details) => {
    const o = open.get(d.requestId);
    if (!o) return;
    open.delete(d.requestId);
    // A CORS block surfaces as net::ERR_FAILED after the response headers arrived (J-065).
    if (o.headers && isCorsBlocked({ type: d.type, url: d.url, initiator: d.initiator, responseHeaders: o.headers })) {
      const headers = toRecord(o.headers);
      sink.emit(o.tabId, {
        t: d.timeStamp,
        kind: 'net.res',
        data: { rid: rid(d), status: o.status ?? 0, headers, ...(headers?.['content-type'] ? { contentType: headers['content-type'] } : {}), timing: { start: o.start, ...(o.ttfb !== undefined ? { ttfb: o.ttfb } : {}), end: d.timeStamp }, source: 'webRequest' },
      } as Omit<CaptureEvent, 'v' | 'id' | 'ctx' | 'seq'>);
      sink.emit(o.tabId, { t: d.timeStamp, kind: 'net.fail', data: { rid: rid(d), error: 'cors', cors: true, source: 'webRequest' } } as Omit<CaptureEvent, 'v' | 'id' | 'ctx' | 'seq'>);
      return;
    }
    const error = d.error === 'net::ERR_ABORTED' ? 'abort' : (d.error ?? 'net::ERR_FAILED');
    sink.emit(o.tabId, { t: d.timeStamp, kind: 'net.fail', data: { rid: rid(d), error, source: 'webRequest' } } as Omit<CaptureEvent, 'v' | 'id' | 'ctx' | 'seq'>);
  };

  const add = <F extends (d: Details) => void>(ev: { addListener: (...a: never[]) => void; removeListener: (...a: never[]) => void }, fn: F, extra: string[]) => {
    try {
      (ev.addListener as (f: F, filter: unknown, extra?: string[]) => void)(fn, filter, extra);
    } catch {
      // older Chromium without extraHeaders
      (ev.addListener as (f: F, filter: unknown, extra?: string[]) => void)(fn, filter, extra.filter((x) => x !== 'extraHeaders'));
    }
    return () => (ev.removeListener as (f: F) => void)(fn);
  };
  const undo = [
    add(wr.onSendHeaders as never, onSend, ['requestHeaders', 'extraHeaders']),
    add(wr.onHeadersReceived as never, onHeaders, ['responseHeaders', 'extraHeaders']),
    add(wr.onResponseStarted as never, onStarted, []),
    add(wr.onCompleted as never, onCompleted, ['responseHeaders', 'extraHeaders']),
    add(wr.onErrorOccurred as never, onError, ['extraHeaders']),
  ];
  // Requests still open after 10 minutes are forgotten (a hanging request stays pending in the capture).
  const sweep = setInterval(() => {
    const cut = Date.now() - 600_000;
    for (const [k, v] of open) if (v.start < cut) open.delete(k);
  }, 60_000);
  return () => {
    clearInterval(sweep);
    for (const u of undo) u();
  };
}
