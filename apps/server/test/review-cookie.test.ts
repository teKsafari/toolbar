// Reviewer cookie for the injector (D-157): the TypeScript signer and the Go verifier
// (apps/injector/cookie.go) agree byte for byte on a shared vector.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeOrigin, safeNext, signReview, verifyReview, type ReviewClaims } from '../src/lib/server/review/cookie.ts';
import { injectorEnabled, injectorOriginListed, reviewLink, reviewSite } from '../src/lib/server/review/index.ts';
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
    expect(injectorOriginListed('https://nuru.example.org', on)).toBe(true);
    expect(injectorOriginListed('https://other.example.org', on)).toBe(false);
    // an empty INJECTOR_ORIGINS lists every origin; the project check still applies (D-201)
    expect(injectorOriginListed('https://other.example.org', e('x'.repeat(32), []))).toBe(true);
  });
  it('review links name the project, and the site only when the project has several (D-201)', () => {
    expect(reviewSite('nuru.example.org')).toBe('https://nuru.example.org');
    expect(reviewSite('http://localhost:5173/x')).toBe('http://localhost:5173');
    expect(reviewSite('javascript:alert(1)')).toBeNull();
    expect(reviewSite(null, ['https://a.example', 'https://*.b.example'])).toBe('https://a.example');
    expect(reviewSite(null, ['https://a.example', 'https://c.example'])).toBeNull();
    expect(reviewSite(null, [])).toBeNull();
    const id = '0b8c3a52-6c55-4f6b-9a8e-2f1f3c1d2e4f';
    expect(reviewLink('https://feedback.example/', id, 'https://a.example', ['https://a.example'])).toBe(`https://feedback.example/go/${id}`);
    expect(reviewLink('https://feedback.example', id, 'https://c.example', ['https://a.example', 'https://c.example'])).toBe(`https://feedback.example/go/${id}?site=https%3A%2F%2Fc.example`);
  });
});
