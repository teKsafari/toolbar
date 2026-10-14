// Helpers for the auth e2e specs: Mailpit lookups, unique addresses, API calls with a page's cookies.
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const run = Date.now().toString(36);
let n = 0;
/**
 * A fresh address per call, so parallel areas sharing Mailpit never see each other's mail.
 * Without a domain each address gets its own, so join-by-domain (J-125, on by default for new
 * workspaces) never pulls one test's users into another test's workspace.
 */
export const uniqueEmail = (domain?: string, who = 'user') => {
  const i = ++n;
  return `${who}-${run}-${i}@${domain ?? `d${run}${i}.test`}`;
};

interface MailSummary { ID: string; Subject: string; To: { Address: string }[] }

/** Wait for the newest message to an address and return its subject and text. */
export async function mailTo(request: APIRequestContext, to: string, subjectRe?: RegExp): Promise<{ subject: string; text: string; html: string }> {
  let hit: MailSummary | undefined;
  await expect
    .poll(async () => {
      const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
      const list = ((await r.json()) as { messages: MailSummary[] }).messages ?? [];
      hit = list.find((m) => !subjectRe || subjectRe.test(m.Subject));
      return !!hit;
    }, { timeout: 15_000, message: `mail to ${to}` })
    .toBe(true);
  const m = (await (await request.get(`${MAILPIT}/api/v1/message/${hit!.ID}`)).json()) as { Subject: string; Text: string; HTML: string };
  return { subject: m.Subject, text: m.Text, html: m.HTML };
}

export const firstUrl = (text: string, prefix = SERVER) => {
  const m = text.match(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s"<>]+`));
  if (!m) throw new Error(`no ${prefix} link in mail:\n${text}`);
  return m[0].replace(/&amp;/g, '&');
};

/** Sign in through the login page with a mailed link (J-217). Leaves the page signed in. */
export async function signInByMail(page: Page, email: string, next = '/') {
  await page.goto(`${SERVER}/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
  await hydrated(page);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  const mail = await mailTo(page.request, email, /Sign in/);
  await page.goto(firstUrl(mail.text, `${SERVER}/api/auth/magic-link/verify`));
  await hydrated(page);
}

export async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto(`${SERVER}/login`);
  await hydrated(page);
  await showPassword(page);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** JSON API call with the page's session cookie. */
export async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await page.request.fetch(`${SERVER}${path}`, {
    method,
    headers: body === undefined ? { origin: SERVER } : { 'content-type': 'application/json', origin: SERVER },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status(), body: (await r.json().catch(() => null)) as T };
}

/** Wait until SvelteKit has hydrated (vite dev loads modules lazily on first visit). */
export async function hydrated(page: Page) {
  await page.waitForLoadState('networkidle');
}

/** Reveal the password field; retries while a cold dev server is still hydrating the page. */
export async function showPassword(page: Page) {
  await expect(async () => {
    if (!(await page.getByLabel('Password').isVisible())) await page.getByRole('button', { name: 'Use a password instead' }).click({ timeout: 2000 });
    await expect(page.getByLabel('Password')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
}
