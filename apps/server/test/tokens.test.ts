import { describe, expect, it } from 'vitest';
import { bearerFrom, hashToken } from '../src/lib/server/tokens.ts';

describe('api tokens', () => {
  it('accepts only our token prefixes', () => {
    expect(bearerFrom('Bearer tb_dev_abc')).toBe('tb_dev_abc');
    expect(bearerFrom('bearer tb_pat_xyz')).toBe('tb_pat_xyz');
    expect(bearerFrom('Bearer eyJhbGciOi')).toBeNull();
    expect(bearerFrom(null)).toBeNull();
  });
  it('hashes to 32 bytes, stable', () => {
    expect(hashToken('tb_dev_a')).toHaveLength(32);
    expect(hashToken('tb_dev_a').equals(hashToken('tb_dev_a'))).toBe(true);
  });
});
