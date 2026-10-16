import { describe, expect, it } from 'vitest';
import { seal, tryUnseal } from '../src/lib/server/crypto.ts';

describe('tryUnseal', () => {
  const secret = 'a'.repeat(48);
  it('opens a value sealed with the same secret and purpose', () => {
    expect(tryUnseal(seal('tok', 'invite-link', secret), 'invite-link', secret)).toBe('tok');
  });
  it('returns null for another secret, another purpose, or junk', () => {
    const s = seal('tok', 'invite-link', secret);
    expect(tryUnseal(s, 'invite-link', 'b'.repeat(48))).toBeNull();
    expect(tryUnseal(s, 'share-token', secret)).toBeNull();
    expect(tryUnseal(Buffer.from('short'), 'invite-link', secret)).toBeNull();
    expect(tryUnseal(null, 'invite-link', secret)).toBeNull();
  });
});
