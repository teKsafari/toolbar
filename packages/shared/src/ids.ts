// Ids and tokens. Runs in browsers, service workers and Node 24 (Web Crypto everywhere).

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** RFC 9562 UUIDv7: 48-bit ms timestamp, then random bits. Sorts by creation time. */
export function uuidv7(now: number = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let ts = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    b[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** Random token: `bytes` random bytes in base64url, with an optional prefix (tb_dev_, tb_pat_). */
export function randomToken(bytes = 16, prefix = ''): string {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', buf as Uint8Array<ArrayBuffer>)));
}

/** PKCE S256 challenge for a verifier (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(d));
}

/** Request id for net.req/net.res pairing, unique per context. */
export function makeRidFactory(ctx: string) {
  let n = 0;
  return () => `${ctx}-${(n++).toString(36)}`;
}
