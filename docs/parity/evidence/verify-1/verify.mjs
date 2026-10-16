import { chromium } from '/home/dev/toolbar/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import { browserEnv } from '../../../../e2e/fixtures/browser-env.ts';
const S = 'http://localhost:3000';
const ID = process.env.CAP ?? '01a14061-b560-7dfd-854c-0eb3780c451c';
const out = {};
const browser = await chromium.launch({ headless: false, env: browserEnv(':161') });
async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(S + '/login');
  await p.waitForLoadState('networkidle');
  if (!(await p.getByLabel('Password').isVisible().catch(() => false))) await p.getByRole('button', { name: 'Use a password instead' }).click();
  await p.getByLabel('Work email').fill('parity@example.com');
  await p.getByLabel('Password').fill('nib parity password');
  await p.getByRole('button', { name: 'Continue', exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await p.close();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tab(cap, id) {
  if (!(await cap.getByTestId('devtools').isVisible().catch(() => false)) && (await cap.getByTestId('narrow-devtools').isVisible().catch(() => false))) await cap.getByTestId('narrow-devtools').click();
  await cap.getByTestId(`tab-${id}`).click();
  await sleep(500);
}
for (const w of [1440, 390]) for (const theme of ['light', 'dark']) {
  const key = `${w}-${theme}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, colorScheme: theme });
  await login(ctx);
  const cap = await ctx.newPage();
  await cap.goto(`${S}/c/${ID}`);
  await cap.waitForLoadState('networkidle').catch(() => {});
  await cap.locator('[data-testid="devtools"]:visible, [data-testid="narrow-devtools"]:visible').first().waitFor({ timeout: 30000 });
  await sleep(800);
  const r = { dataTheme: await cap.evaluate(() => document.documentElement.getAttribute('data-theme')), bodyBg: await cap.evaluate(() => getComputedStyle(document.body).backgroundColor) };
  r.chapterPill = await cap.getByTestId('chapter-pill').count();
  r.chapterText = await cap.evaluate(() => /chapter/i.test(document.body.innerText));
  await tab(cap, 'network');
  await cap.screenshot({ path: `net-${key}.png` });
  r.net = await cap.getByTestId('network-list').evaluate((list) => {
    const rows = [...list.querySelectorAll('.nrow')].slice(0, 3);
    const hs = [...list.querySelectorAll('.hrow [role=columnheader]')];
    return hs.map((h) => {
      const col = h.dataset.col; const hb = h.getBoundingClientRect();
      const cells = rows.map((row) => { const c = row.querySelector(`[data-col="${col}"]`); return c ? Math.round(c.getBoundingClientRect().left * 10) / 10 : null; });
      return { col, label: h.textContent.trim(), hx: Math.round(hb.left * 10) / 10, hw: Math.round(hb.width), cells, clipped: h.scrollWidth > h.clientWidth + 1, textW: (() => { const rg = document.createRange(); rg.selectNodeContents(h); return Math.round(rg.getBoundingClientRect().width); })() };
    });
  });
  r.netMax = Math.max(...r.net.map((c) => Math.max(...c.cells.filter((x) => x != null).map((x) => Math.abs(x - c.hx)))));
  r.netClipped = r.net.filter((c) => c.clipped).map((c) => c.label);
  r.netOverflow = await cap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // console
  await tab(cap, 'console');
  const list = cap.getByTestId('console-list');
  const rows = list.locator('[role=listitem]');
  const n = await rows.count();
  r.consoleRows = n;
  const opened = [];
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const text = (await row.innerText()).replace(/\s+/g, ' ').trim();
    if (!/[\[{]|Date|Map|20\d\d-/.test(text)) continue;
    await row.click();
    await sleep(300);
    const after = (await row.innerText());
    opened.push({ before: text.slice(0, 200), after: after.slice(0, 600), wire: /\$t/.test(after), frames: await row.getByTestId('stack-frames').locator('li').allInnerTexts().catch(() => []) });
    await row.click(); await sleep(150);
  }
  r.opened = opened;
  await cap.screenshot({ path: `console-${key}.png` });
  r.consoleOverflow = await cap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  out[key] = r;
  await ctx.close();
}
fs.writeFileSync('out.json', JSON.stringify(out, null, 2));
await browser.close();
