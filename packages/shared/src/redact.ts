// Redaction applied in the isolated world before an event leaves the page (architecture s10,
// J-185 to J-187). Pure functions, no DOM: the extension, the Part 2 injector and the server's
// tests share them. Owned by the capture area.
import type { CaptureEvent, Headers } from './events.ts';
import { REDACT_HEADER_RE } from './constants.ts';
import { bodyAllowed, OPEN_BODY_POLICY, type BodyPolicy } from './projects.ts';

/** Placeholder for a removed header or body value. */
export const REDACTED = '[redacted]';
/** Typed text in a masked field: asterisks whose count does not follow the input (J-187). */
export const MASKED_TYPING = '********';

/** Body field names whose values are removed whatever they hold (J-186). */
export const SECRET_FIELD_RE =
  /^(.*passw(or)?d.*|pass|passphrase|pwd|.*secret.*|.*token.*|.*api[-_]?key.*|auth|authorization|email|e-?mail[-_]?address|card|card[-_]?(number|num|no)|.*credit[-_]?card.*|cc[-_]?(number|num)|cvc|cvv|ssn|otp|pin)$/i;

const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** 13 to 19 digits, optionally grouped by spaces or dashes. Luhn decides. */
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export interface ScrubOptions {
  /** Replace email addresses too (bodies: yes; typed text in plain fields: no). */
  emails?: boolean;
}

/** Content-based scrub: JWTs, card numbers (Luhn) and, optionally, email addresses. */
export function scrubText(s: string, opts: ScrubOptions = {}): string {
  if (!s) return s;
  let out = s.replace(JWT_RE, REDACTED);
  out = out.replace(CARD_RE, (m) => (luhn(m.replace(/[ -]/g, '')) ? REDACTED : m));
  if (opts.emails) out = out.replace(EMAIL_RE, REDACTED);
  return out;
}

export function isSecretHeader(name: string): boolean {
  return REDACT_HEADER_RE.test(name);
}

/** Headers with secret values replaced; `redacted` lists the names (viewer shield badge, J-185). */
export function redactHeaders(h: Headers | undefined): { headers: Headers | undefined; redacted: string[] } {
  if (!h) return { headers: h, redacted: [] };
  const headers: Headers = {};
  const redacted: string[] = [];
  for (const [k, v] of Object.entries(h)) {
    if (isSecretHeader(k)) {
      headers[k] = REDACTED;
      redacted.push(k.toLowerCase());
    } else headers[k] = scrubText(v);
  }
  return { headers, redacted };
}

/** Query parameters with secret-looking names are blanked; the rest is content-scrubbed. */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return scrubText(url);
  const hashAt = url.indexOf('#', q);
  const base = url.slice(0, q);
  const query = url.slice(q + 1, hashAt < 0 ? undefined : hashAt);
  const hash = hashAt < 0 ? '' : url.slice(hashAt);
  const parts = query.split('&').map((p) => {
    const eq = p.indexOf('=');
    if (eq < 0) return p;
    const k = p.slice(0, eq);
    let name = k;
    try {
      name = decodeURIComponent(k);
    } catch {
      /* keep raw */
    }
    return SECRET_FIELD_RE.test(name) ? `${k}=${encodeURIComponent(REDACTED)}` : scrubText(p);
  });
  return `${base}?${parts.join('&')}${hash}`;
}

function redactJsonValue(v: unknown, depth = 0): unknown {
  if (depth > 32) return v;
  if (typeof v === 'string') return scrubText(v, { emails: true });
  if (Array.isArray(v)) return v.map((x) => redactJsonValue(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = SECRET_FIELD_RE.test(k) && x !== null && typeof x !== 'object' ? REDACTED : redactJsonValue(x, depth + 1);
    }
    return out;
  }
  return v;
}

/**
 * Request or response body with secret fields replaced. JSON and form bodies are parsed and
 * rebuilt; other text gets the content scrub. Bodies that fail to parse fall back to the scrub.
 */
export function redactBody(body: string | undefined, contentType?: string): string | undefined {
  if (body === undefined || body === '') return body;
  const ct = (contentType ?? '').toLowerCase();
  const trimmed = body.trimStart();
  if (ct.includes('json') || ((trimmed.startsWith('{') || trimmed.startsWith('[')) && !ct.includes('html'))) {
    try {
      return JSON.stringify(redactJsonValue(JSON.parse(body)));
    } catch {
      /* not JSON after all */
    }
  }
  if (ct.includes('x-www-form-urlencoded') || (!ct && /^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(body))) {
    return body
      .split('&')
      .map((p) => {
        const eq = p.indexOf('=');
        if (eq < 0) return p;
        let name = p.slice(0, eq);
        try {
          name = decodeURIComponent(name.replace(/\+/g, ' '));
        } catch {
          /* keep raw */
        }
        if (SECRET_FIELD_RE.test(name)) return `${p.slice(0, eq)}=${encodeURIComponent(REDACTED)}`;
        let value = p.slice(eq + 1);
        try {
          value = encodeURIComponent(scrubText(decodeURIComponent(value.replace(/\+/g, ' ')), { emails: true }));
        } catch {
          /* keep raw */
        }
        return `${p.slice(0, eq)}=${value}`;
      })
      .join('&');
  }
  if (ct.includes('multipart/form-data')) {
    // Text parts: `Content-Disposition: form-data; name="x"` then a blank line and the value.
    return body.replace(/(name="([^"]*)"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n)([^\r\n]*)/g, (_m, head: string, name: string, value: string) =>
      head + (SECRET_FIELD_RE.test(name) ? REDACTED : scrubText(value, { emails: true })),
    );
  }
  return scrubText(body, { emails: true });
}

/** Field descriptor for typing and click masking. Plain data so it crosses worlds. */
export interface FieldInfo {
  tag: string;
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
}

/** Whether typed text in this field is masked (J-187: email and password; plus secret-looking names). */
export function isMaskedField(f: FieldInfo, preset: 'staging' | 'production' | 'none' = 'staging'): boolean {
  if (preset === 'production') return true;
  const type = (f.type ?? '').toLowerCase();
  if (type === 'password' || type === 'email') return true;
  const ac = (f.autocomplete ?? '').toLowerCase();
  if (/(password|email|cc-|one-time-code)/.test(ac)) return true;
  for (const n of [f.name, f.id]) if (n && SECRET_FIELD_RE.test(n)) return true;
  return false;
}

/** Value to record for typed text: masked fields become MASKED_TYPING, others get the content scrub. */
export function typedValue(value: string, f: FieldInfo, preset: 'staging' | 'production' | 'none' = 'staging'): { value: string; masked: boolean } {
  if (isMaskedField(f, preset)) return { value: MASKED_TYPING, masked: true };
  const scrubbed = scrubText(value);
  return { value: scrubbed, masked: scrubbed !== value };
}

/**
 * Redacts one capture event in place of a copy. Network headers, bodies and URLs, WebSocket and
 * SSE payloads and console strings get the content scrub; typed values were masked at the source.
 */
export function redactEvent(e: CaptureEvent): CaptureEvent {
  switch (e.kind) {
    case 'net.req': {
      const { headers } = redactHeaders(e.data.headers);
      const ct = e.data.headers ? Object.entries(e.data.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] : undefined;
      return { ...e, data: { ...e.data, url: redactUrl(e.data.url), headers, body: redactBody(e.data.body, ct) } };
    }
    case 'net.res': {
      const { headers } = redactHeaders(e.data.headers);
      return { ...e, data: { ...e.data, headers, body: redactBody(e.data.body, e.data.contentType) } };
    }
    case 'ws':
      return e.data.data === undefined ? e : { ...e, data: { ...e.data, url: e.data.url && redactUrl(e.data.url), data: redactBody(e.data.data) } };
    case 'sse':
      return e.data.data === undefined ? e : { ...e, data: { ...e.data, data: redactBody(e.data.data) } };
    case 'nav':
      return { ...e, data: { ...e.data, url: redactUrl(e.data.url), from: e.data.from && redactUrl(e.data.from) } };
    case 'console':
      return { ...e, data: { ...e.data, args: e.data.args.map((a) => scrubSerialized(a)) } };
    case 'error':
      return { ...e, data: { ...e.data, message: scrubText(e.data.message) } };
    default:
      return e;
  }
}

function scrubSerialized(v: import('./events.ts').Serialized, depth = 0): import('./events.ts').Serialized {
  if (depth > 8) return v;
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map((x) => scrubSerialized(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, import('./events.ts').Serialized> = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_FIELD_RE.test(k) && typeof x === 'string' && k !== 'stack' ? REDACTED : scrubSerialized(x, depth + 1);
    return out;
  }
  return v;
}

/**
 * Redaction plus the project's body policy (PLAN "Privacy", D-123). Response events carry only
 * the request id, so the redactor remembers each request's decision. `pageUrl` is read on each
 * event, since single-page apps change it.
 */
export function createRedactor(getPolicy: () => BodyPolicy = () => OPEN_BODY_POLICY, pageUrl: () => string | undefined = () => undefined) {
  const dropped = new Map<string, true>();
  const streams = new Map<string, true>();
  const remember = (rid: string) => {
    dropped.set(rid, true);
    if (dropped.size > 2000) dropped.delete(dropped.keys().next().value!);
  };
  return (raw: CaptureEvent): CaptureEvent => {
    const e = redactEvent(raw);
    const policy = getPolicy();
    if (policy.preset === 'none') return e;
    switch (e.kind) {
      case 'net.req': {
        if (bodyAllowed(policy, e.data.url, pageUrl())) return e;
        remember(e.data.rid);
        const { body: _b, bodyTruncated: _t, ...rest } = e.data;
        return { ...e, data: { ...rest, bodyOmitted: 'masking' } };
      }
      case 'net.res': {
        if (!dropped.has(e.data.rid)) return e;
        const { body: _b, truncated: _t, ...rest } = e.data;
        return { ...e, data: { ...rest, bodyOmitted: 'masking' } };
      }
      case 'ws':
      case 'sse': {
        // frames after `open` carry only the stream id: reuse the decision made on its URL
        const key = `${e.kind}:${e.data.sid}`;
        if (e.data.url) {
          if (bodyAllowed(policy, e.data.url, pageUrl())) streams.set(key, true);
          else streams.delete(key);
          if (streams.size > 500) streams.delete(streams.keys().next().value!);
        }
        if (e.data.data === undefined || streams.has(key)) return e;
        const { data: _d, ...rest } = e.data;
        return { ...e, data: { ...rest, bodyOmitted: 'masking' } } as CaptureEvent;
      }
      default:
        return e;
    }
  };
}
