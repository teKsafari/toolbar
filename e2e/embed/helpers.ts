// Shared by the embed suite: the site owner's signed-in API, the lab's project with its embed
// key, and the captures the embed made.
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { signInOidc } from '../fixtures/oidc.ts';

export const SERVER = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
export const LAB = process.env.LAB_URL ?? 'http://localhost:5173';
/** the lab's second origin (lab/server.js, PORT+1): not a project origin */
export const OTHER = process.env.LAB_OTHER_URL ?? `${new URL(LAB).protocol}//${new URL(LAB).hostname}:${Number(new URL(LAB).port) + 1}`;

/** The lab page `path` with the embed's script tag for `key` (lab/server.js, opt-in). */
export function labUrl(key: string, path = '/', base = LAB, extra = ''): string {
  const u = new URL(path, base);
  u.searchParams.set('tb-embed', key);
  return u.toString() + extra;
}

export interface Owner {
  api: APIRequestContext;
  email: string;
  workspaceId: string;
  close(): Promise<void>;
}

/** A site owner: a fresh account through the mock OIDC provider, admin of its own workspace. */
export async function signInOwner(browser: Browser): Promise<Owner> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = `embed-owner-${Date.now()}@toolbar.test`;
  await signInOidc(page, SERVER, email, { name: 'Olu Owner' });
  const me = (await (await ctx.request.get(`${SERVER}/api/v1/me`)).json()) as { activeWorkspaceId: string | null };
  expect(me.activeWorkspaceId, 'a first sign-in gets a workspace').toBeTruthy();
  await page.close();
  return { api: ctx.request, email, workspaceId: me.activeWorkspaceId!, close: () => ctx.close() };
}

const json = { origin: SERVER };

/** A project with this origin in the owner's workspace; its id. */
export async function ensureProject(owner: Owner, origin: string): Promise<string> {
  const list = (await (await owner.api.get(`${SERVER}/api/v1/workspaces/${owner.workspaceId}/projects`, { headers: json })).json()) as { items: { id: string; origins: string[] }[] };
  const have = list.items.find((p) => p.origins.includes(origin));
  if (have) return have.id;
  const r = await owner.api.post(`${SERVER}/api/v1/workspaces/${owner.workspaceId}/projects`, { headers: json, data: { name: new URL(origin).host, origins: [origin], maskingPreset: 'staging' } });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

/** Turn the embed on with a new key (the old one stops working); the key. */
export async function rotateKey(owner: Owner, projectId: string): Promise<string> {
  const r = await owner.api.post(`${SERVER}/api/v1/projects/${projectId}/embed-key`, { headers: json });
  expect(r.status(), await r.text()).toBe(200);
  const key = ((await r.json()) as { embedKey: string | null }).embedKey;
  expect(key).toMatch(/^tbk_[A-Za-z0-9_-]{22}$/);
  return key!;
}

export async function turnOff(owner: Owner, projectId: string): Promise<void> {
  const r = await owner.api.delete(`${SERVER}/api/v1/projects/${projectId}/embed-key`, { headers: json });
  expect(r.status(), await r.text()).toBe(200);
  expect(((await r.json()) as { embedKey: string | null }).embedKey).toBeNull();
}

export interface Summary {
  id: string;
  kind: string;
  title: string;
  status: string;
  source: string;
}

/** The ids of the owner's captures that came from the embed. */
export async function embedCaptures(owner: Owner): Promise<Summary[]> {
  const r = await owner.api.get(`${SERVER}/api/v1/recordings?sources=embed`);
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { items: Summary[] }).items;
}

/** The newest embed capture not in `before`, once the server has processed it. */
export async function nextCapture(owner: Owner, before: string[], kind?: string): Promise<Summary> {
  let found: Summary | undefined;
  await expect
    .poll(
      async () => {
        const items = (await embedCaptures(owner)).filter((c) => !before.includes(c.id) && (!kind || c.kind === kind));
        found = items.find((c) => c.status === 'ready');
        return found ? 'ready' : (items[0]?.status ?? 'none');
      },
      { timeout: 90_000, intervals: [1000, 2000] },
    )
    .toBe('ready');
  return found!;
}

/** The toolbar's controls live in an open shadow root; Playwright's test id locators pierce it. */
export const ui = (page: Page, id: string) => page.getByTestId(id);

/** The pill or its collapsed launcher is on screen. */
export async function toolbarShown(page: Page) {
  await expect(ui(page, 'review-launcher').or(ui(page, 'review-pill'))).toBeVisible({ timeout: 20_000 });
}

export async function wake(page: Page) {
  if (await ui(page, 'review-pill').isVisible()) return;
  await ui(page, 'review-launcher').click();
  await expect(ui(page, 'review-pill')).toBeVisible();
}

/** Console lines of the embed (`[open-toolbar] ...`) and page errors, collected from now on. */
export function watchConsole(page: Page) {
  const embed: { type: string; text: string }[] = [];
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('[open-toolbar]')) embed.push({ type: m.type(), text: m.text() });
    if (m.type() === 'error') console.log(`[console error] ${m.text()} ${m.location().url}`);
  });
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log(`[page error] ${e.message}`);
  });
  return { embed, errors };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
