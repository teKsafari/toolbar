// @vitest-environment happy-dom
// The embed's HTTP client (D-211): its upload routes match the server's route table, the key's
// routes follow the contract, and nothing carries the page's cookies.
import { describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@toolbar/shared/api';
import { EMBED_ROUTES, EmbedHttpError, createEmbedClient } from '../src/client';

describe('embed routes', () => {
  it('the upload routes match the route table', () => {
    for (const [name, r] of Object.entries(EMBED_ROUTES)) {
      if (name.startsWith('embed.')) continue;
      const def = ROUTES[name as keyof typeof ROUTES];
      expect(def, name).toBeDefined();
      expect(def.method, name).toBe(r.method);
      expect(def.path, name).toBe(r.path);
    }
  });

  it('the key routes are the contract paths', () => {
    expect(EMBED_ROUTES['embed.config']).toEqual({ method: 'GET', path: '/api/v1/embed/:key/config' });
    expect(EMBED_ROUTES['embed.create']).toEqual({ method: 'POST', path: '/api/v1/embed/:key/recordings' });
  });
});

describe('embed client', () => {
  it('fetches the config by key without credentials or a bearer', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ workspaceId: 'ws' }), { headers: { 'content-type': 'application/json' } }));
    const c = createEmbedClient(f as unknown as typeof fetch, 'https://tb.example/', 'tbk_a b');
    expect(await c.config()).toEqual({ workspaceId: 'ws' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://tb.example/api/v1/embed/tbk_a%20b/config');
    expect(init.credentials).toBe('omit');
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('turns an error body into EmbedHttpError with its code', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'origin_not_allowed', message: 'No' }), { status: 403, headers: { 'content-type': 'application/json' } }));
    const c = createEmbedClient(f as unknown as typeof fetch, 'https://tb.example', 'tbk_x');
    const e = await c.config().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EmbedHttpError);
    expect(e).toMatchObject({ status: 403, code: 'origin_not_allowed', message: 'No' });
    const n = createEmbedClient((async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch, 'https://tb.example', 'tbk_x');
    expect(await n.config().catch((x: unknown) => x)).toMatchObject({ status: 0, code: 'network' });
  });
});
