// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import { countNodes, watchPageWeight, type PageWeight } from '../src/page-weight.ts';
import { startIsolatedWorld } from '../src/isolated.ts';
import { MemoryTransport } from '../src/transport.ts';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('page weight (J-011)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('counts elements without the toolbar host', () => {
    document.body.innerHTML = '<ul>' + '<li><button>x</button><span>1</span></li>'.repeat(500) + '</ul>';
    const base = countNodes(document);
    expect(base).toBeGreaterThanOrEqual(1501);
    const host = document.createElement(UI_HOST_TAG);
    host.innerHTML = '<div><div></div></div>';
    document.body.append(host);
    expect(countNodes(document)).toBe(base);
  });

  it('reports node count and mutation rate after the first delay, then on its interval', async () => {
    document.body.innerHTML = '<div id="t"></div>';
    const seen: PageWeight[] = [];
    const w = watchPageWeight((x) => seen.push(x), window as Window & typeof globalThis, { firstMs: 60, everyMs: 60 });
    const t = document.getElementById('t')!;
    for (let i = 0; i < 50; i++) t.setAttribute('data-n', String(i));
    await tick(90);
    expect(seen.length).toBe(1);
    expect(seen[0]!.nodes).toBeGreaterThan(0);
    expect(seen[0]!.mutationsPerSec).toBeGreaterThan(0);
    await tick(80);
    expect(seen.length).toBe(2);
    expect(seen[1]!.mutationsPerSec).toBe(0);
    w.stop();
    await tick(80);
    expect(seen.length).toBe(2);
  });

  it('the isolated world reports weight only while the replay ring is on', async () => {
    const weights: PageWeight[] = [];
    const t = new (class extends MemoryTransport {
      sendPageWeight(w: PageWeight) {
        weights.push(w);
      }
    })();
    startIsolatedWorld({ transport: t, dom: false, env: false, pageWeight: { firstMs: 20, everyMs: 20 } });
    await tick(60);
    expect(weights).toEqual([]);
    t.command({ type: 'ring', enabled: true, minutes: 2 });
    await tick(60);
    expect(weights.length).toBeGreaterThan(0);
    t.command({ type: 'ring', enabled: false, minutes: 2 });
    const n = weights.length;
    await tick(60);
    expect(weights.length).toBe(n);
  });
});
