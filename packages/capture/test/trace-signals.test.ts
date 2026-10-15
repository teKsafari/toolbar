// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { DomSummary } from '@toolbar/shared';
import { observeDom } from '../src/dom-summary.ts';
import { fnv1a, pixelDiff, watchCanvases } from '../src/canvas-sample.ts';

const W = window as unknown as Window & typeof globalThis;

describe('dom summary texts (traces)', () => {
  it('reports changed and added text, scrubbed, only when asked', async () => {
    document.body.innerHTML = '<p id="status">idle</p>';
    const out: DomSummary[] = [];
    let texts = true;
    const obs = observeDom((d) => out.push(d), W, 10, { texts: () => texts });
    document.getElementById('status')!.firstChild!.textContent = 'saved for ada@example.test';
    const div = document.createElement('div');
    div.textContent = 'Could not save the order';
    document.body.append(div);
    await new Promise((r) => setTimeout(r, 30));
    expect(out).toHaveLength(1);
    expect(out[0]!.texts).toHaveLength(2);
    expect(out[0]!.texts!.join(' ')).toContain('Could not save the order');
    expect(out[0]!.texts!.join(' ')).not.toContain('ada@example.test');
    texts = false;
    div.textContent = 'again';
    await new Promise((r) => setTimeout(r, 30));
    expect(out[1]!.texts).toBeUndefined();
    obs.stop();
  });
});

describe('canvas samples', () => {
  it('hashes and diffs pixel data', () => {
    const a = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255]);
    const b = new Uint8ClampedArray([0, 0, 0, 255, 200, 10, 10, 255]);
    expect(fnv1a(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a(a)).not.toBe(fnv1a(b));
    expect(pixelDiff(a, a)).toBe(0);
    expect(pixelDiff(a, b)).toBe(0.5);
    expect(pixelDiff(a, new Uint8ClampedArray(4))).toBe(1);
  });

  it('samples nothing until started, and nothing without a visible canvas', () => {
    document.body.innerHTML = '<button>go</button>';
    const emit = vi.fn();
    const w = watchCanvases(emit, W);
    document.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(w.running).toBe(false);
    w.start();
    // happy-dom events are untrusted and the page has no canvas: still nothing
    document.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(emit).not.toHaveBeenCalled();
    w.stop();
    expect(w.running).toBe(false);
  });
});
