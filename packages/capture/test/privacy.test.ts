// @vitest-environment happy-dom
// Masking presets in the isolated world (D-119): events wait for the preset, and the production
// preset masks page text in action targets.
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import { describeNode, maskText } from '../src/target.ts';
import { startIsolatedWorld } from '../src/isolated.ts';
import { MemoryTransport } from '../src/transport.ts';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
function trusted<E extends Event>(e: E): E {
  Object.defineProperty(e, 'isTrusted', { value: true });
  return e;
}

describe('production preset', () => {
  it('masks text, names and attribute values of a target, keeps its structure', () => {
    document.body.innerHTML = '<main><button data-testid="pay" class="btn" title="Pay Ada">Pay 42 EUR</button><input type="email" value="ada@x.test" placeholder="Your email"></main>';
    const b = describeNode(document.querySelector('button'), { preset: 'production' })!;
    expect(b).toMatchObject({ tag: 'button', role: 'button', testId: 'pay', classes: ['btn'], text: '*** ** ***' });
    expect(b.attrs).toMatchObject({ title: '*** ***', type: 'submit', 'data-testid': 'pay' });
    const i = describeNode(document.querySelector('input'), { preset: 'production' })!;
    expect(JSON.stringify(i)).not.toMatch(/ada@x\.test|Your email/);
    expect(maskText('a b\tc')).toBe('* *\t*');
  });

  it('holds events until the first config, then sends them under its preset', async () => {
    document.body.innerHTML = '<button data-testid="go">Secret label</button>';
    const t = new MemoryTransport();
    startIsolatedWorld({ transport: t, dom: false, env: false, awaitConfig: true, batchMs: 5 });
    document.querySelector('button')!.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    await tick(30);
    expect(t.events).toEqual([]);
    t.command({ type: 'config', maskingPreset: 'production', bodyPolicy: { preset: 'production', origins: [], allowlist: [] } });
    await tick(30);
    const clicks = t.events.filter((e: CaptureEvent) => e.kind === 'user');
    expect(clicks).toHaveLength(1);
    expect(JSON.stringify(clicks[0])).not.toContain('Secret label');
  });

  it('without awaitConfig sends at once (injector, tests)', async () => {
    document.body.innerHTML = '<button>Hi</button>';
    const t = new MemoryTransport();
    startIsolatedWorld({ transport: t, dom: false, env: false, batchMs: 5 });
    document.querySelector('button')!.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    await tick(30);
    expect(t.events.some((e: CaptureEvent) => e.kind === 'user')).toBe(true);
  });
});
