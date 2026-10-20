// The reviewer toolbar talks to its platform only (D-212): requests, stored settings, the Open
// action and the reviewer's name all go through the ReviewPlatform set before it mounts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOLBAR_CLOSED_KEY } from '@toolbar/shared/areas/ext-ui';
import type { ReviewItem } from '@toolbar/shared/ext';
import { Review } from '../src/state.svelte.ts';
import { setPlatform, type ReviewPlatform, type ReviewRequestType } from '../src/platform.ts';
import { toasts } from '@toolbar/ui';

function fakePlatform(over: Partial<ReviewPlatform> = {}) {
  const store = new Map<string, unknown>();
  const listeners = new Map<string, (v: unknown) => void>();
  const calls: { type: ReviewRequestType; req: unknown }[] = [];
  const items: ReviewItem[] = [];
  const answers: Partial<Record<ReviewRequestType, (req: never) => object>> = {
    'review.get': () => ({ items: items.slice() }),
    'review.context': () => ({ context: { errors: [], failedRequests: [] } }),
    'review.add': (req: { item: ReviewItem }) => {
      const it = { ...req.item, id: `i${items.length + 1}`, n: items.length + 1, context: { windowMs: 60_000, errors: [], failedRequests: [] }, t: 1 } as ReviewItem;
      items.push(it);
      return { item: it };
    },
    'review.submit': () => {
      const count = items.length;
      items.length = 0;
      return { result: { recordingId: 'rec-1', url: '', count, trace: false } };
    },
    'trace.get': () => ({ trace: null }),
    'locator.capture': () => ({ locator: { masking: 'staging' }, crop: null }),
  };
  const p: ReviewPlatform = {
    async request(type, req) {
      calls.push({ type, req });
      const a = answers[type];
      return (a ? { ok: true, ...a(req as never) } : { ok: false, error: 'not_implemented' }) as never;
    },
    storage: {
      get: async <T,>(k: string) => store.get(k) as T | undefined,
      set: async (k, v) => void store.set(k, v),
      onChange: (k, fn) => {
        listeners.set(k, fn);
        return () => listeners.delete(k);
      },
    },
    assetUrl: (f) => `https://tb.example/embed/${f}`,
    caps: { canScreenshot: false },
    ...over,
  };
  return { p, store, listeners, calls, items };
}

describe('review platform', () => {
  beforeEach(() => {
    setPlatform(null);
  });

  it('reads the dock position and the closed sites from the platform storage', async () => {
    const f = fakePlatform();
    f.store.set('tb:review-pos', { [location.origin]: { h: 'l', v: 't', x: 40, y: 50 } });
    f.store.set(TOOLBAR_CLOSED_KEY, { [location.origin]: 1 });
    setPlatform(f.p);
    const r = new Review();
    await r.init();
    expect(r.pos).toEqual({ h: 'l', v: 't', x: 40, y: 50 });
    expect(r.closed).toBe(true);
    // another tab reopened the site
    f.listeners.get(TOOLBAR_CLOSED_KEY)!({});
    expect(r.closed).toBe(false);
    expect(f.calls.map((c) => c.type)).toEqual(['review.get', 'trace.get']);
  });

  it('a trace request the platform lacks turns traces off', async () => {
    const f = fakePlatform();
    setPlatform(f.p);
    const r = new Review();
    await r.refreshTrace();
    expect(r.traceAvailable).toBe(true);
    const g = fakePlatform({ request: async () => ({ ok: false, error: 'not_implemented' }) as never });
    setPlatform(g.p);
    await r.refreshTrace();
    expect(r.traceAvailable).toBe(false);
  });

  it('closing and reopening write the closed map through the platform', async () => {
    const f = fakePlatform();
    setPlatform(f.p);
    const r = new Review();
    await r.close();
    expect(f.store.get(TOOLBAR_CLOSED_KEY)).toHaveProperty(location.origin);
    await r.reopen();
    expect(f.store.get(TOOLBAR_CLOSED_KEY)).toEqual({});
  });

  it('without screenshots the shot tool stays off and no crop is asked for', async () => {
    const f = fakePlatform();
    setPlatform(f.p);
    const r = new Review();
    r.setTool('shot');
    expect(r.tool).toBe(null);
    r.setTool('comment');
    expect(r.tool).toBe('comment');
  });

  it('asks the name once, saves it with the first note and sends without an Open action', async () => {
    const save = vi.fn(async () => undefined);
    const f = fakePlatform({ reviewer: { load: async () => ({ name: '', ask: true }), save } });
    setPlatform(f.p);
    const r = new Review();
    await r.init();
    expect(r.askName).toBe(true);
    r.reviewerName = '  Ada  ';
    r.openDraft({ id: null, kind: 'note', label: 'Note', shapes: [], comment: 'The total is wrong', intent: 'fix', severity: 'important', at: { x: 0, y: 0 } });
    await r.saveDraft();
    expect(save).toHaveBeenCalledWith('Ada');
    expect(r.askName).toBe(false);
    expect(r.items).toHaveLength(1);
    const update = vi.spyOn(toasts, 'update');
    expect(await r.submit('')).toBe(true);
    const last = update.mock.calls.at(-1)![1] as { message: string; action?: unknown };
    expect(last.message).toBe('Sent 1 note');
    expect(last.action).toBeUndefined();
    expect(f.calls.some((c) => c.type === 'review.submit')).toBe(true);
  });

  it('the Open action goes to the platform when it can open captures', async () => {
    const openCapture = vi.fn();
    const f = fakePlatform({ openCapture });
    setPlatform(f.p);
    const r = new Review();
    r.openDraft({ id: null, kind: 'note', label: 'Note', shapes: [], comment: 'x', intent: 'fix', severity: 'important', at: { x: 0, y: 0 } });
    await r.saveDraft();
    const update = vi.spyOn(toasts, 'update');
    await r.submit('');
    const last = update.mock.calls.at(-1)![1] as { action?: { run: () => void } };
    last.action!.run();
    expect(openCapture).toHaveBeenCalledWith({ recordingId: 'rec-1', url: '', count: 1, trace: false });
  });
});
