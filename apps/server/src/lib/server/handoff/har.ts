// raw/network.har: the folder's requests as HAR 1.2 (http://www.softwareishard.com/blog/har-12-spec/)
// for tools that read HAR. Built from the same redacted rows as network.jsonl.
import { PRODUCT_NAME } from '@toolbar/shared/constants';

export interface HarRow {
  t: number;
  method: string;
  url: string;
  status: number | null;
  statusText: string | null;
  state: string;
  error: string | null;
  durationMs: number | null;
  size: number | null;
  contentType: string | null;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string | null;
  responseBody?: string | null;
  timing: { dns: number | null; connect: number | null; ttfb: number | null; download: number | null } | null;
}

const pairs = (h?: Record<string, string>) => Object.entries(h ?? {}).map(([name, value]) => ({ name, value }));

function query(url: string) {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

const header = (h: Record<string, string> | undefined, name: string) => Object.entries(h ?? {}).find(([k]) => k.toLowerCase() === name)?.[1] ?? null;

export function toHar(rows: readonly HarRow[], page: { url: string | null; title: string | null; startedAt: number }, version = '1'): object {
  const pageId = 'page_1';
  return {
    log: {
      version: '1.2',
      creator: { name: PRODUCT_NAME, version },
      pages: [{ startedDateTime: new Date(page.startedAt).toISOString(), id: pageId, title: page.title ?? page.url ?? '', pageTimings: {} }],
      entries: rows.map((r) => {
        const total = r.durationMs ?? -1;
        const reqCt = header(r.requestHeaders, 'content-type');
        return {
          pageref: pageId,
          startedDateTime: new Date(r.t).toISOString(),
          time: Math.max(0, total),
          request: {
            method: r.method,
            url: r.url,
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: pairs(r.requestHeaders),
            queryString: query(r.url),
            ...(r.requestBody ? { postData: { mimeType: reqCt ?? 'text/plain', text: r.requestBody } } : {}),
            headersSize: -1,
            bodySize: r.requestBody ? r.requestBody.length : 0,
          },
          response: {
            status: r.status ?? 0,
            statusText: r.statusText ?? (r.state === 'pending' ? 'pending (no answer while recording)' : (r.error ?? '')),
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: pairs(r.responseHeaders),
            content: { size: r.size ?? (r.responseBody?.length ?? 0), mimeType: r.contentType ?? 'x-unknown', ...(r.responseBody ? { text: r.responseBody } : {}) },
            redirectURL: header(r.responseHeaders, 'location') ?? '',
            headersSize: -1,
            bodySize: r.size ?? -1,
            ...(r.error ? { _error: r.error } : {}),
          },
          cache: {},
          timings: {
            blocked: -1,
            dns: r.timing?.dns ?? -1,
            connect: r.timing?.connect ?? -1,
            send: 0,
            wait: r.timing?.ttfb ?? Math.max(0, total),
            receive: r.timing?.download ?? 0,
            ssl: -1,
          },
          _state: r.state,
        };
      }),
    },
  };
}
