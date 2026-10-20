// @vitest-environment node
// Server rendering imports the package and may call init: nothing touches window, nothing throws.
import { describe, expect, it } from 'vitest';

describe('server rendering', () => {
  it('imports and init does nothing without a window', async () => {
    const { init } = await import('../src/index');
    expect(typeof window).toBe('undefined');
    expect(() => init({ key: 'tbk_x', server: 'https://tb.example' })).not.toThrow();
  });
});
