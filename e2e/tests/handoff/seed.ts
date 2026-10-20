// Seeding for the bulk export and thumbnail specs (D-183, D-184): a fresh account through the
// mock OIDC provider (its own workspace, on a domain no other test uses), a personal token, and
// captures made over the HTTP API the way the embed's page bundle makes them
// (packages/embed, session.ts): source "embed", events and rrweb streams as gzipped
// NDJSON chunks, finalize with the reviewer's words. No still is sent, so the server draws the card.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { STREAM_CONTENT_TYPES, type CaptureEvent } from '@toolbar/shared';
import { commentedEvents, screenshotEvents, tabVideoEvents } from '../../../apps/server/fixtures/events.ts';
import { signInOidc } from '../../fixtures/oidc.ts';

export const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';
const run = Date.now().toString(36);

/** Sign a new person in (their own workspace) and make a personal token with API and MCP scopes. */
export async function newAccount(page: Page, who = 'agent'): Promise<{ email: string; token: string; workspaceId: string }> {
  const email = `${who}-${run}@exp${run}.test`;
  if ((await page.request.get(`${SERVER}/api/v1/me`)).status() !== 200) await signInOidc(page, SERVER, email, { name: `Export ${who}` });
  const me = (await (await page.request.get(`${SERVER}/api/v1/me`)).json()) as { activeWorkspaceId: string; email: string };
  expect(me.activeWorkspaceId, 'a first sign-in gets a workspace').toBeTruthy();
  const res = await page.request.post(`${SERVER}/api/v1/tokens`, { headers: { origin: SERVER }, data: { name: `export e2e ${run}`, scopes: ['cli:read', 'cli:write', 'mcp:read'], expiresInDays: 7 } });
  expect(res.status(), await res.text()).toBe(201);
  return { email: me.email, token: ((await res.json()) as { secret: string }).secret, workspaceId: me.activeWorkspaceId };
}

const shift = (events: CaptureEvent[], t0: number): CaptureEvent[] => {
  const first = Math.min(...events.map((e) => e.t));
  return events.map((e) => ({ ...e, t: e.t - first + t0 }));
};

export const FIXTURE_EVENTS = {
  /** a checkout with a dead click, a hanging request, a silent 500 and an uncaught error */
  checkout: (t0: number) => shift(tabVideoEvents(), t0),
  /** the submit button whose 500 the page does not show */
  submit: (t0: number) => shift(screenshotEvents(), t0),
  /** a form whose post answers 403 */
  form: (t0: number) => shift(commentedEvents(), t0),
};

/** A minimal DOM recording: meta and a full snapshot of an empty page, as rrweb writes them. */
function rrwebOf(t0: number, url: string) {
  return [
    { type: 4, timestamp: t0, data: { href: url, width: 1280, height: 720 } },
    { type: 2, timestamp: t0 + 1, data: { node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: 'html', attributes: {}, childNodes: [] }] }, initialOffset: { left: 0, top: 0 } } },
  ];
}

export interface Seed {
  kind: 'replay' | 'trace';
  title: string;
  comment?: string;
  events?: keyof typeof FIXTURE_EVENTS;
  url?: string;
  pageTitle?: string;
}

/** One capture as the embed's page bundle makes it; returns its id once the server took it. */
export async function embedCapture(request: APIRequestContext, token: string, workspaceId: string, s: Seed): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const t0 = Date.now() - 90_000;
  const url = s.url ?? 'http://localhost:5173/checkout';
  const events = s.events ? FIXTURE_EVENTS[s.events](t0) : [];
  const lastT = events.length ? Math.max(...events.map((e) => e.t)) : t0 + 5000;
  const created = await request.post(`${SERVER}/api/v1/recordings`, {
    headers: auth,
    data: { clientId: crypto.randomUUID(), kind: s.kind, workspaceId, page: { url, title: s.pageTitle ?? 'Lab checkout' }, startedAt: t0, source: 'embed', durationMs: lastT - t0 },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  for (const [stream, rows] of [
    ['events', events],
    ['rrweb', rrwebOf(t0, url)],
  ] as const) {
    if (!rows.length) continue;
    const gz = gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const put = await request.put(`${SERVER}/api/v1/recordings/${id}/streams/${stream}/chunks/0`, {
      headers: { ...auth, 'content-type': STREAM_CONTENT_TYPES[stream], 'content-encoding': 'gzip', 'x-sha256': createHash('sha256').update(gz).digest('hex'), 'x-t0': String(t0), 'x-t1': String(lastT) },
      data: gz,
    });
    expect(put.ok(), await put.text()).toBe(true);
    const done = await request.post(`${SERVER}/api/v1/recordings/${id}/streams/${stream}/complete`, { headers: auth, data: { lastSeq: 0, totalBytes: gz.byteLength } });
    expect(done.ok(), await done.text()).toBe(true);
  }
  const fin = await request.post(`${SERVER}/api/v1/recordings/${id}/finalize`, {
    headers: auth,
    data: { title: s.title, description: s.comment ?? '', annotations: s.comment ? [{ t: 2000, shapes: [], comment: s.comment }] : [] },
  });
  expect(fin.ok(), await fin.text()).toBe(true);
  return id;
}

/** A screenshot capture with the server's fixture PNG, as an API client uploads one. */
export async function screenshotCapture(request: APIRequestContext, token: string, workspaceId: string, title: string): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const png = readFileSync(new URL('../../../apps/server/fixtures/screenshot.png', import.meta.url));
  const created = await request.post(`${SERVER}/api/v1/recordings`, { headers: auth, data: { clientId: crypto.randomUUID(), kind: 'screenshot', workspaceId, page: { url: 'http://localhost:5173/pricing', title: 'Pricing' }, startedAt: Date.now() } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const a = await request.post(`${SERVER}/api/v1/assets`, { headers: auth, multipart: { kind: 'screenshot', recordingId: id, file: { name: 'shot.png', mimeType: 'image/png', buffer: png } } });
  expect(a.ok(), await a.text()).toBe(true);
  const fin = await request.post(`${SERVER}/api/v1/recordings/${id}/finalize`, { headers: auth, data: { title, screenshotAssetId: ((await a.json()) as { id: string }).id, annotations: [] } });
  expect(fin.ok(), await fin.text()).toBe(true);
  return id;
}

export async function waitReady(request: APIRequestContext, token: string, id: string) {
  await expect
    .poll(async () => ((await (await request.get(`${SERVER}/api/v1/recordings/${id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as { status?: string }).status, { timeout: 120_000, intervals: [1000] })
    .toBe('ready');
}
