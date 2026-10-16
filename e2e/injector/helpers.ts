// Shared by the injector suites (injector.spec.ts, coolify.spec.ts).
import { execFileSync } from 'node:child_process';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const toolbar = (page: Page) => page.locator('toolbar-root [role=toolbar]');

/** A project with this origin in the signed-in person's active workspace; its id. */
export async function ensureProject(request: APIRequestContext, server: string, origin: string): Promise<string> {
  const headers = { origin: server };
  const ws = (await (await request.get(`${server}/api/v1/workspaces`, { headers })).json()) as { items: { id: string }[]; activeId: string | null };
  const id = ws.activeId ?? ws.items[0]!.id;
  const list = (await (await request.get(`${server}/api/v1/workspaces/${id}/projects`, { headers })).json()) as { items: { id: string; origins: string[] }[] };
  const have = list.items.find((p) => p.origins.includes(origin));
  if (have) return have.id;
  const r = await request.post(`${server}/api/v1/workspaces/${id}/projects`, { headers, data: { name: new URL(origin).host, origins: [origin], maskingPreset: 'staging' } });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

/** The ids of the person's captures made by the injector's toolbar. */
export async function injectorCaptures(request: APIRequestContext, server: string): Promise<string[]> {
  const r = await request.get(`${server}/api/v1/recordings?sources=injector`);
  return ((await r.json()) as { items: { id: string }[] }).items.map((c) => c.id);
}

/** Newest capture of the injector source in the reviewer's workspace, once it is processed. */
export async function latestCapture(request: APIRequestContext, server: string, after: string[] = []) {
  let found: { id: string; title: string } | null = null;
  await expect
    .poll(
      async () => {
        const r = await request.get(`${server}/api/v1/recordings?sources=injector`);
        if (!r.ok()) return `http ${r.status()}`;
        const items = ((await r.json()) as { items: { id: string; title: string; status: string }[] }).items.filter((c) => !after.includes(c.id));
        const ready = items.find((c) => c.status === 'ready');
        found = ready ?? null;
        return ready ? 'ready' : (items[0]?.status ?? 'none');
      },
      { timeout: 60_000 },
    )
    .toBe('ready');
  return found! as { id: string; title: string };
}

/** Run docker compose on the coolify-like stack (COMPOSE_FILE, set by its run.sh). */
export function compose(...args: string[]): string {
  const file = process.env.COMPOSE_FILE;
  if (!file) throw new Error('COMPOSE_FILE is not set: run apps/injector/test/coolify-like/run.sh');
  return execFileSync('docker', ['compose', '-f', file, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The injector's request log lines (one per request it handled; health checks are not logged). */
export function injectorRequests(): { kind: string; host: string; path: string; status: string; injected: boolean }[] {
  return compose('logs', '--no-log-prefix', 'open-toolbar-injector')
    .split('\n')
    .filter((l) => l.includes('msg=request'))
    .map((l) => {
      const f = (k: string) => new RegExp(`(?:^| )${k}=(\\S+)`).exec(l)?.[1] ?? '';
      return { kind: f('kind'), host: f('host'), path: f('path'), status: f('status'), injected: f('injected') === 'true' };
    });
}
