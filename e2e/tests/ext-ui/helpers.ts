// Helpers for the ext-ui specs: drive the worker's ext-ui hooks (globalThis.__tbUi in test
// builds), open the popup as a tab bound to a lab tab, and reach into the open shadow root.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { EXT_ID, LAB_URL } from '../../fixtures/extension.ts';

export interface TbUi {
  useFakeDriver(opts?: { mic?: string; startDelayMs?: number; failStart?: string }): void;
  calls(): { fn: string; args: unknown }[];
  stats(): {
    popupOpens: number;
    captures: string[];
    shots: { rect: { x: number; y: number; w: number; h: number } | null; dpr: number }[];
    marks: string[];
    stops: string[];
    transitions: string[];
    errors: string[];
    settingsPushed: number;
    icon: string;
    commands: string[];
  };
  stub(type: string, res: unknown): void;
  clearStubs(): void;
  session(): Promise<Record<string, unknown> & { state: string }>;
  dispatch(e: unknown): Promise<unknown>;
  reset(): Promise<void>;
  command(name: string, tabId: number): Promise<void>;
  setSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
}
declare global {
  // eslint-disable-next-line no-var
  var __tbUi: TbUi;
}

export const AUTH = {
  serverUrl: 'http://localhost:1',
  token: 'tb_dev_e2e_not_a_real_token',
  tokenId: '019a0000-0000-7000-8000-00000000e2e0',
  user: { id: '019a0000-0000-7000-8000-00000000e2e1', name: 'Test Reviewer', email: 'test@nib.test', image: null },
  activeWorkspaceId: '019a0000-0000-7000-8000-0000000000a1',
  signedInAt: 0,
};

/** Fresh worker state: idle session, fake capture driver, signed in, default settings. */
export async function freshState(sw: Worker, opts: { mic?: string; auth?: Partial<typeof AUTH> | null; settings?: Record<string, unknown> } = {}) {
  await sw.evaluate(
    async ({ mic, auth, settings }) => {
      await __tbUi.reset();
      __tbUi.useFakeDriver(mic ? { mic } : {});
      await chrome.storage.local.remove(['nib:drafts', 'nib:bootstrap', 'nib:server-url']);
      await chrome.storage.session.remove(['nib:replay', 'nib:heavy-override']);
      if (auth) await chrome.storage.local.set({ 'nib:auth': auth });
      else await chrome.storage.local.remove('nib:auth');
      await __tbUi.setSettings(settings ?? {});
    },
    { mic: opts.mic, auth: opts.auth === null ? null : { ...AUTH, ...(opts.auth ?? {}) }, settings: opts.settings },
  );
}

export async function labPage(context: BrowserContext, path = '/'): Promise<{ page: Page; tabId: number }> {
  const page = await context.newPage();
  await page.goto(LAB_URL + path);
  await page.locator('toolbar-root [data-nb-ui]').waitFor({ state: 'attached' });
  await page.bringToFront();
  const tabId = await tabIdOf(context, page);
  return { page, tabId };
}

/** Chrome tab id of a page, matched by a marker in its URL hash-free href. */
export async function tabIdOf(context: BrowserContext, page: Page): Promise<number> {
  const sw = context.serviceWorkers()[0]!;
  const marker = `nib-${Math.random().toString(36).slice(2)}`;
  await page.evaluate((m) => (document.title = `${document.title} ${m}`), marker);
  const id = await sw.evaluate(async (m) => {
    for (let i = 0; i < 50; i++) {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => x.title?.includes(m));
      if (t?.id) return t.id;
      await new Promise((r) => setTimeout(r, 50));
    }
    return -1;
  }, marker);
  await page.evaluate((m) => (document.title = document.title.replace(` ${m}`, '')), marker);
  return id;
}

/** The popup page, opened as a tab and bound to a lab tab (the action popup cannot be scripted). */
export async function openPopup(context: BrowserContext, tabId: number): Promise<Page> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 640 }).catch(() => undefined);
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html?tabId=${tabId}`);
  await popup.locator('[data-popup][data-loading="false"]').waitFor();
  return popup;
}

export const session = (sw: Worker) => sw.evaluate(() => __tbUi.session());
export const stats = (sw: Worker) => sw.evaluate(() => __tbUi.stats());
export const calls = (sw: Worker) => sw.evaluate(() => __tbUi.calls());

/** Small JSON server standing in for the API routes other areas build. */
export async function mockServer(routes: Record<string, (body: unknown) => unknown>) {
  const hits: { method: string; path: string; body: unknown; auth: string | undefined }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const key = `${req.method} ${req.url?.split('?')[0]}`;
      hits.push({ method: req.method!, path: req.url!, body, auth: req.headers.authorization });
      const h = routes[key];
      res.setHeader('access-control-allow-origin', '*');
      if (!h) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(h(body)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { url, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}
