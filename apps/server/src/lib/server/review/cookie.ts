// Reviewer cookie for the injector (PLAN "Zero integration", delivery 2; D-130). The server signs
// it for one app origin after sign-in; the injector (apps/injector) checks it offline with the
// shared INJECTOR_SECRET, injects the toolbar for its holder, and relays the page bundle's upload
// calls here with the device token inside as a bearer. Format, shared with apps/injector/cookie.go
// and pinned by apps/injector/testdata/review-cookie.json:
//
//   tbr1.<base64url(JSON {v,o,u,x,k})>.<base64url(HMAC-SHA256(secret, "tbr1." + payload part))>
import { createHmac, timingSafeEqual } from 'node:crypto';

export const REVIEW_COOKIE_PREFIX = 'tbr1.';

export interface ReviewClaims {
  v: 1;
  /** the app origin the cookie works on, e.g. https://nuru.example.org */
  o: string;
  /** user id */
  u: string;
  /** expiry, unix seconds */
  x: number;
  /** device token the injector sends to this server as a bearer */
  k: string;
}

const mac = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest();

export function signReview(secret: string, c: ReviewClaims): string {
  // Key order matches the Go struct, so both sides produce the same bytes.
  const body = JSON.stringify({ v: c.v, o: c.o, u: c.u, x: c.x, k: c.k });
  const part = Buffer.from(body).toString('base64url');
  return `${REVIEW_COOKIE_PREFIX}${part}.${mac(secret, REVIEW_COOKIE_PREFIX + part).toString('base64url')}`;
}

/** The claims of a valid cookie for `origin`, else null. */
export function verifyReview(secret: string, value: string, origin: string, now = Date.now()): ReviewClaims | null {
  if (!secret || !value.startsWith(REVIEW_COOKIE_PREFIX)) return null;
  const [part, sig, extra] = value.slice(REVIEW_COOKIE_PREFIX.length).split('.');
  if (!part || !sig || extra !== undefined) return null;
  const want = mac(secret, REVIEW_COOKIE_PREFIX + part);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let c: ReviewClaims;
  try {
    c = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as ReviewClaims;
  } catch {
    return null;
  }
  if (c.v !== 1 || !c.k || !c.o || Math.floor(now / 1000) >= c.x) return null;
  return c.o.toLowerCase() === origin.toLowerCase() ? c : null;
}

/** "https://App.example.org:443/x" -> "https://app.example.org"; null when not an http(s) origin. */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Same-origin path only; anything else becomes "/". */
export const safeNext = (n: string | null | undefined) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') && !/[\r\n]/.test(n) ? n : '/');
