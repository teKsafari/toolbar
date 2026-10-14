import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, fromBase64url, pkceChallenge, randomToken, sha256Hex, uuidv7, uuidv7Time } from '../src/index.ts';

describe('ids', () => {
  it('makes valid, time-ordered UUIDv7s', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(uuidv7Time(a)).toBe(1_700_000_000_000);
  });

  it('round-trips base64url', () => {
    const bytes = Uint8Array.from([0, 251, 255, 1, 62, 63]);
    expect(fromBase64url(base64url(bytes))).toEqual(bytes);
  });

  it('makes 22-character 128-bit share tokens with prefixes', () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(32, 'tb_dev_')).toMatch(/^tb_dev_[A-Za-z0-9_-]{43}$/);
  });

  it('hashes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('computes the PKCE S256 challenge like node:crypto', async () => {
    const v = randomToken(32);
    expect(await pkceChallenge(v)).toBe(createHash('sha256').update(v).digest('base64url'));
  });
});
