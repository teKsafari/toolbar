// @vitest-environment happy-dom
// Starting the embed (D-211): the script tag's settings, the per-browser reviewer, the stored
// clips, and init's guards (no window, iframes, a second call, a key that does not work).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scriptConfig } from '../src/boot';
import { REVIEWER_KEY, ReviewerStore } from '../src/reviewer';
import { BlobStore } from '../src/store';
import { serverOrigin } from '../src/init';

function tag(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
}

describe('script tag', () => {
  it('reads the key, the server from the script origin, and the reviewer', () => {
    expect(scriptConfig(tag({ src: 'https://toolbar.example.com/embed.js?v=3', 'data-key': ' tbk_abc ', 'data-name': 'Ada', 'data-email': 'ada@example.com' }), 'https://app.example.org/')).toEqual({
      key: 'tbk_abc',
      server: 'https://toolbar.example.com',
      user: { name: 'Ada', email: 'ada@example.com' },
    });
    expect(scriptConfig(tag({ src: '/embed.js', 'data-key': 'tbk_abc' }), 'http://localhost:3000/page')).toEqual({ key: 'tbk_abc', server: 'http://localhost:3000' });
  });

  it('needs a script with a src and a key', () => {
    expect(scriptConfig(null)).toBeNull();
    expect(scriptConfig(document.createElement('div'))).toBeNull();
    expect(scriptConfig(tag({ src: 'https://t.example/embed.js' }))).toBeNull();
    expect(scriptConfig(tag({ 'data-key': 'tbk_abc' }))).toBeNull();
    expect(scriptConfig(tag({ src: 'data:text/javascript,1', 'data-key': 'tbk_abc' }))).toBeNull();
  });

  it('takes an http(s) server only', () => {
    expect(serverOrigin('https://t.example/')).toBe('https://t.example');
    expect(serverOrigin('https://t.example/toolbar/')).toBe('https://t.example/toolbar');
    expect(serverOrigin('javascript:alert(1)')).toBeNull();
    expect(serverOrigin('t.example')).toBeNull();
  });
});

describe('reviewer', () => {
  beforeEach(() => localStorage.clear());

  it('keeps one random id per browser and the name typed once', async () => {
    const a = new ReviewerStore();
    const id = a.get().id;
    expect(id).toMatch(/^r_[0-9a-f]{32}$/);
    expect(await a.load()).toEqual({ name: '', ask: true });
    await a.save('  Ada Lovelace ');
    const b = new ReviewerStore();
    expect(b.get()).toEqual({ id, name: 'Ada Lovelace' });
    expect(await b.load()).toEqual({ name: 'Ada Lovelace', ask: false });
    expect(JSON.parse(localStorage.getItem(REVIEWER_KEY)!)).toMatchObject({ id, name: 'Ada Lovelace', asked: true });
  });

  it('a name from the site is not asked for; a bad email is dropped', async () => {
    const r = new ReviewerStore({ name: 'Grace', email: 'not an email' });
    expect(await r.load()).toEqual({ name: 'Grace', ask: false });
    expect(r.get()).toEqual({ id: r.get().id, name: 'Grace' });
    expect(new ReviewerStore({ email: 'g@example.com' }).get().email).toBe('g@example.com');
  });

  it('replaces a stored id that is not one of ours', () => {
    localStorage.setItem(REVIEWER_KEY, JSON.stringify({ id: '<script>' }));
    expect(new ReviewerStore().get().id).toMatch(/^r_/);
  });
});

describe('blob store', () => {
  it('keeps clips in IndexedDB and sweeps old ones', async () => {
    const s = new BlobStore();
    const id = await s.put('voice', new Blob(['abc'], { type: 'audio/webm' }));
    const t = new BlobStore();
    const back = (await t.get(id)) as unknown as { size?: number } | undefined;
    // happy-dom's Blob does not survive fake-indexeddb's clone as a Blob; that it comes back is enough here
    expect(back).toBeDefined();
    await t.sweep(1000, Date.now() + 5000);
    expect(await new BlobStore().get(id)).toBeUndefined();
  });
});

describe('init', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs one line and shows nothing when the key does not work', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    const { init } = await import('../src/init');
    init({ key: 'tbk_gone', server: 'https://tb.example' });
    init({ key: 'tbk_gone', server: 'https://tb.example' });
    await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(1));
    expect(info.mock.calls[0]![0]).toBe('[open-toolbar] not started: the key is unknown or turned off');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://tb.example/api/v1/embed/tbk_gone/config');
    expect(document.querySelector('toolbar-root')).toBeNull();
    expect(typeof window.openToolbar?.show).toBe('function');
  });
});
