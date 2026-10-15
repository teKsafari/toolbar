// Reviewer cookie for the injector (D-123): the TypeScript signer and the Go verifier
// (apps/injector/cookie.go) agree byte for byte on a shared vector.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeOrigin, safeNext, signReview, verifyReview, type ReviewClaims } from '../src/lib/server/review/cookie.ts';
import { injectorEnabled, reviewOriginAllowed } from '../src/lib/server/review/index.ts';
import type { Env } from '../src/lib/server/env.ts';

const vector = JSON.parse(readFileSync(new URL('../../injector/testdata/review-cookie.json', import.meta.url), 'utf8')) as { secret: string; claims: ReviewClaims; value: string };
const at = (vector.claims.x - 10) * 1000;

describe('reviewer cookie', () => {
  it('signs the shared vector as the Go injector does', () => {
    expect(signReview(vector.secret, vector.claims)).toBe(vector.value);
  });
  it('verifies the vector for its origin only, before expiry, with the right secret', () => {
    expect(verifyReview(vector.secret, vector.value, vector.claims.o, at)).toEqual(vector.claims);
    expect(verifyReview(vector.secret, vector.value, 'https://evil.example', at)).toBeNull();
    expect(verifyReview(vector.secret, vector.value, vector.claims.o, vector.claims.x * 1000)).toBeNull();
    expect(verifyReview('another-secret-0123456789abcdef0123', vector.value, vector.claims.o, at)).toBeNull();
    expect(verifyReview(vector.secret, vector.value + 'x', vector.claims.o, at)).toBeNull();
    expect(verifyReview(vector.secret, 'tbr1.a.b.c', vector.claims.o, at)).toBeNull();
  });
  it('normalizes origins and keeps next paths on the same origin', () => {
    expect(normalizeOrigin('https://App.Example.org:443/lesson?x=1')).toBe('https://app.example.org');
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(safeNext('/a?b=1')).toBe('/a?b=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
  });
  it('is off without a long enough secret, and only for listed origins', () => {
    const e = (secret: string, origins: string[]) => ({ injector: { secret, origins, cookieDays: 7 } }) as unknown as Env;
    expect(injectorEnabled(e('short', []))).toBe(false);
    expect(injectorEnabled(e('x'.repeat(32), []))).toBe(true);
    const on = e('x'.repeat(32), ['https://nuru.example.org/']);
    expect(reviewOriginAllowed('https://nuru.example.org', on)).toBe(true);
    expect(reviewOriginAllowed('https://other.example.org', on)).toBe(false);
    expect(reviewOriginAllowed(null, on)).toBe(false);
  });
});
