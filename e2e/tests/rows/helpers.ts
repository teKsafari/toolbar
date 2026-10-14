// Helpers for the close-out specs: a real account on the server under test (sign-up through the
// login page, then a personal token), the extension signed in with that token, and a local
// stand-in for the GitHub REST API that a workspace connects to with a token and a base URL.
import { expect, type Browser, type Page, type Worker } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { callbackHost } from '../../fixtures/net.ts';
import { SERVER, json, me, newContext, signIn, uniqueEmail } from '../dashboard/helpers.ts';

export { SERVER };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

export interface Account {
  email: string;
  userId: string;
  name: string;
  workspaceId: string;
  token: string;
  /** a signed-in browser page on the server */
  page: Page;
}

/** Signs up a fresh account in its own context and mints a personal token for the extension. */
export async function account(browser: Browser, who = 'rows'): Promise<Account> {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const email = uniqueEmail(undefined, who);
  await signIn(page, email);
  const m = await me(page);
  const t = await json<{ secret: string }>(page, 'POST', '/api/v1/tokens', { name: 'extension e2e', expiresInDays: 7, scopes: ['cli:read', 'cli:write'] });
  const full = await json<{ name: string }>(page, 'GET', '/api/v1/me');
  return { email, userId: m.id, name: full.name, workspaceId: m.activeWorkspaceId, token: t.secret, page };
}

let current: Account | null = null;

/** The extension's stored sign-in, pointing at the server under test with a real token; idle session. */
export async function signInExtension(sw: Worker, a: Account) {
  current = a;
  await sw.evaluate(async () => {
    const g = globalThis as unknown as { __tb: { ready(): Promise<unknown> }; __tbUi?: { reset(): Promise<void>; session(): Promise<{ state: string }> } };
    await g.__tb.ready();
    for (let i = 0; i < 10 && g.__tbUi; i++) {
      await g.__tbUi.reset();
      await new Promise((r) => setTimeout(r, 150));
      if ((await g.__tbUi.session()).state === 'idle') break;
    }
  });
  await sw.evaluate(
    async ({ serverUrl, token, ws, user }) => {
      await chrome.storage.local.set({
        'nib:auth': { serverUrl, token, tokenId: 'tok-rows', user, activeWorkspaceId: ws, signedInAt: Date.now() },
        'nib:server-url': serverUrl,
        'nib:bootstrap': null,
        'nib:editor-prefs': null,
      });
    },
    { serverUrl: SERVER, token: a.token, ws: a.workspaceId, user: { id: a.userId, name: a.name, email: a.email, image: null } },
  );
}

/** Extension settings, locally and on the account (the popup pulls the account's copy, J-215). */
export async function setExtSettings(sw: Worker, patch: Record<string, unknown>, a?: Account) {
  const who = a ?? current;
  if (who) await json(who.page, 'PATCH', '/api/v1/me/settings', { extension: patch });
  await sw.evaluate(async (patch) => {
    const cur = (await chrome.storage.local.get('nib:settings'))['nib:settings'] ?? {};
    await chrome.storage.local.set({ 'nib:settings': { ...cur, ...patch } });
  }, patch);
  await new Promise((r) => setTimeout(r, 200));
}

export interface GitHubMock {
  /** what the browser opens (issue pages) */
  url: string;
  /** the API root the server calls (fixtures/net.ts) */
  apiUrl: string;
  token: string;
  /** issues filed through POST /repos/:owner/:repo/issues */
  issues: { repo: string; title: string; body: string; labels?: string[]; assignees?: string[]; milestone?: number }[];
  /** answer every API call with 502 */
  down: boolean;
  close(): Promise<void>;
}

/** GitHub REST API stand-in: /user, /user/repos, labels, assignees, milestones, issues. */
export async function githubMock(): Promise<GitHubMock> {
  const token = `ghp_rows_${Date.now().toString(36)}`;
  const m: GitHubMock = { url: '', apiUrl: '', token, issues: [], down: false, close: async () => {} };
  let n = 41;
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = req.url ?? '/';
      const send = (status: number, body: unknown, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      // the filed issue's page, opened in a new tab
      if (req.method === 'GET' && /^\/acme\/[\w-]+\/issues\/\d+$/.test(url)) return send(200, `<!doctype html><title>Issue ${url}</title><h1 id="issue">${url}</h1>`, 'text/html');
      if (m.down) return send(502, { message: 'bad gateway' });
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'Bad credentials' });
      if (url === '/user') return send(200, { login: 'rows-bot' });
      if (url.startsWith('/user/repos')) return send(200, [{ id: 1, full_name: 'acme/shop' }, { id: 2, full_name: 'acme/api' }]);
      const r = url.match(/^\/repos\/(acme\/[\w-]+)\/(labels|assignees|milestones|issues)/);
      if (r && req.method === 'GET' && r[2] === 'labels') return send(200, [{ name: 'bug', color: 'd73a4a' }, { name: 'checkout', color: '0e8a16' }]);
      if (r && req.method === 'GET' && r[2] === 'assignees') return send(200, [{ login: 'sam-gh', avatar_url: null }, { login: 'kim-gh', avatar_url: null }]);
      if (r && req.method === 'GET' && r[2] === 'milestones') return send(200, [{ number: 3, title: 'v1.0' }]);
      if (r && req.method === 'POST' && r[2] === 'issues') {
        const b = JSON.parse(raw);
        m.issues.push({ repo: r[1]!, ...b });
        n++;
        return send(201, { html_url: `${m.url}/${r[1]}/issues/${n}`, number: n, title: b.title });
      }
      return send(404, { message: 'Not Found' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '0.0.0.0', () => r()));
  m.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  m.apiUrl = `http://${callbackHost()}:${(srv.address() as AddressInfo).port}`;
  m.close = () => new Promise<void>((r) => {
    srv.closeAllConnections();
    srv.close(() => r());
  });
  return m;
}

/** A Slack incoming webhook stand-in on this machine (the server accepts http only for this machine). */
export async function slackMock() {
  const posts: { text: string }[] = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      posts.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '0.0.0.0', () => r()));
  const host = callbackHost() === '127.0.0.1' ? 'localhost' : callbackHost();
  return { url: `http://${host}:${(srv.address() as AddressInfo).port}/services/T0/B0/x`, posts, close: () => new Promise<void>((r) => {
      srv.closeAllConnections();
      srv.close(() => r());
    }) };
}

/** Connect GitHub (with the mock as its API root) and return the integration id. */
export async function connectGithub(a: Account, gh: GitHubMock, defaultRepo?: string) {
  const i = await json<{ id: string }>(a.page, 'POST', `/api/v1/workspaces/${a.workspaceId}/integrations`, { type: 'github', token: gh.token, baseUrl: gh.apiUrl, name: 'GitHub acme', ...(defaultRepo ? { defaultRepo } : {}) });
  return i.id;
}

export async function connectSlack(a: Account, webhookUrl: string, name = 'Slack bugs') {
  const i = await json<{ id: string }>(a.page, 'POST', `/api/v1/workspaces/${a.workspaceId}/integrations`, { type: 'slack', webhookUrl, channelLabel: '#bugs', name });
  return i.id;
}

/** Text on the system clipboard, read from a page of the given origin. */
export async function clipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

export { expect };
