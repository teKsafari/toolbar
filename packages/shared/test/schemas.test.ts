import { describe, expect, it } from 'vitest';
import {
  createRecordingSchema,
  finalizeRecordingSchema,
  extTokenExchangeSchema,
  chunkInfoSchema,
  REDACT_HEADER_RE,
  COMMANDS,
  uuidv7,
} from '../src/index.ts';

describe('API DTO schemas', () => {
  it('accepts a minimal create-recording body', () => {
    const r = createRecordingSchema.parse({
      clientId: uuidv7(),
      kind: 'video',
      workspaceId: 'w1',
      page: { url: 'http://localhost:5173/' },
      startedAt: Date.now(),
    });
    expect(r.page.title).toBe('');
  });

  it('rejects an unknown recording kind', () => {
    expect(() =>
      createRecordingSchema.parse({ clientId: uuidv7(), kind: 'gif', workspaceId: 'w', page: { url: '' }, startedAt: 0 }),
    ).toThrow();
  });

  it('fills finalize defaults', () => {
    expect(finalizeRecordingSchema.parse({})).toEqual({ title: '', description: '', annotations: [] });
  });

  it('checks PKCE verifier length', () => {
    expect(extTokenExchangeSchema.safeParse({ code: 'x'.repeat(16), code_verifier: 'short' }).success).toBe(false);
  });

  it('caps chunk size and checks the hash format', () => {
    expect(chunkInfoSchema.safeParse({ seq: 0, bytes: 9 * 1024 * 1024, sha256: 'a'.repeat(64) }).success).toBe(false);
    expect(chunkInfoSchema.safeParse({ seq: 0, bytes: 10, sha256: 'z'.repeat(64) }).success).toBe(false);
    expect(chunkInfoSchema.safeParse({ seq: 0, bytes: 10, sha256: 'a'.repeat(64) }).success).toBe(true);
  });
});

describe('constants', () => {
  it('redacts sensitive header names only', () => {
    for (const h of ['Authorization', 'cookie', 'Set-Cookie', 'X-Api-Key', 'x-csrf-token', 'client-secret', 'apikey'])
      expect(REDACT_HEADER_RE.test(h), h).toBe(true);
    for (const h of ['content-type', 'accept', 'x-request-id']) expect(REDACT_HEADER_RE.test(h), h).toBe(false);
  });

  it('has at most four suggested shortcut keys (Chrome limit)', () => {
    expect(Object.values(COMMANDS).filter((c) => c.key).length).toBeLessThanOrEqual(4);
  });
});
