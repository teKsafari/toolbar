// Screenshots of the reviewer toolbar on Nuru, real input through xdotool on :264.
import fs from 'node:fs';
import { connect, clickEl, clickAt, dragScreen, key, type, sleep, xshot, NURU, EXT_ID, log } from './drv.mjs';
const OUT = '/home/dev/demo-run/shots';
const { browser, ctx } = await connect();
const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`));
for (const p of ctx.pages()) if (p.url().includes('popup.html')) await p.close();
const page = ctx.pages().find((p) => p.url().startsWith(NURU)) ?? ctx.pages()[0];
await page.bringToFront();
const traceId = () => sw.evaluate(async () => ((await chrome.storage.local.get('tb:trace'))['tb:trace'] ?? null)?.recordingId ?? null);
const unsent = () => sw.evaluate(async () => Object.values((await chrome.storage.session.get('tb:review'))['tb:review'] ?? {}).flatMap((t) => t.items.map((i) => ({ kind: i.kind }))));
async function waitFor(fn, ms, what) { const until = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > until) throw new Error('timed out: ' + what); await sleep(300); } }
async function editor(code) {
  await clickEl(page, page.getByTestId('editor').locator('.cm-content'));
  await sleep(300); key('ctrl+a'); key('Delete');
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) { type(lines[i], 50); if (i < lines.length - 1) { key('Return'); key('shift+Home'); key('Delete'); } }
  await sleep(500);
}
async function note(text, count, before) {
  await sleep(600); type(text, 20); await sleep(500);
  if (before) xshot(before);
  key('Return');
  await waitFor(async () => (await unsent()).length >= count, 15000, `note ${count}`);
  log(`note ${count} kept`);
}
await page.goto(NURU + '/sw'); await page.waitForLoadState('load');
await waitFor(() => page.locator('toolbar-root').count(), 15000, 'toolbar host');
await sleep(2000);
key('ctrl+shift+period'); await sleep(800);
xshot(`${OUT}/raw-toolbar-awake.png`);
key('x');
const rid = await waitFor(traceId, 20000, 'trace started');
fs.writeFileSync('/home/dev/demo-run/trace-id', rid); log('trace ' + rid);
await sleep(1500);
await clickEl(page, page.getByRole('link', { name: 'Anza' }).first());
await page.waitForURL(/karibu/, { timeout: 20000 }); await sleep(3000);
await editor('// Salamu yangu ya kwanza\nandika("Habari Nuru! Mimi ni Amani")');
await clickEl(page, page.getByTestId('run')); await sleep(2500);
xshot(`${OUT}/raw-trace-running.png`);
const line = page.locator('div.break-words.whitespace-pre-wrap', { hasText: 'Habari Nuru!' }).first();
const lb = await line.boundingBox();
await dragScreen(page, [[lb.x + 1, lb.y + lb.height / 2], [lb.x + 120, lb.y + lb.height / 2], [lb.x + Math.min(lb.width, 260) - 2, lb.y + lb.height / 2]]);
await sleep(500); key('t');
await note('Output is right, but the lesson text around it is English on /sw.', 1, `${OUT}/raw-highlight-composer.png`);
key('c'); await sleep(400);
await clickEl(page, page.locator('h1').first(), { hover: 600 });
xshot(`${OUT}/raw-element-hover.png`);
await note('Step 1 title and body are English on the Swahili site.', 2, `${OUT}/raw-comment-composer.png`);
key('Escape'); await sleep(800);
xshot(`${OUT}/raw-pins.png`);
// stop: blur the editor first so the key reaches the toolbar
const b = await page.locator('h1').first().boundingBox();
await clickAt(page, b.x + 5, b.y - 18); await sleep(400);
key('x');
await waitFor(async () => !(await traceId()), 90000, 'trace stopped');
await sleep(2500);
xshot(`${OUT}/raw-stopped.png`);
log('stopped');
await browser.close();
