// Ten-minute Nuru lesson session at human speed (experiment 1). Mode: off | idle | trace.
// Real input through xdotool on :262; Playwright over CDP only reads boxes and text.
import fs from 'node:fs';
import { connect, clickEl, clickAt, screenOf, key, type, sleep, xshot, xdo, NURU, EXT_ID, log } from './drv.mjs';
import { startMeasure } from './measure.mjs';

const MODE = process.argv[2] ?? 'trace';
const OUT = `/home/dev/nuru-exp/runs/${MODE}-${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });
const TOTAL = 600_000;
const TYPE_MS = Number(process.env.TYPE_MS ?? 150);

const { browser, ctx } = await connect();
for (const p of ctx.pages()) if (!p.url().startsWith(NURU) && !p.url().startsWith('about:blank')) await p.close().catch(() => {});
let page = ctx.pages().find((p) => p.url().startsWith(NURU)) ?? ctx.pages()[0];
await page.bringToFront();
const sw = MODE === 'off' ? null : ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`));
const traceId = () => sw.evaluate(async () => ((await chrome.storage.local.get('tb:trace'))['tb:trace'] ?? null)?.recordingId ?? null);
async function waitFor(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > until) throw new Error('timed out: ' + what); await sleep(300); }
}
const marks = [];
let t0 = 0;
const step = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); log(`[${MODE}] ${name}`); };
const terminal = () => page.evaluate(() => [...document.querySelectorAll('div.break-words.whitespace-pre-wrap')].map((e) => e.innerText).join('\n')).catch(() => '');
async function editor(code) {
  await clickEl(page, page.getByTestId('editor').locator('.cm-content'));
  await sleep(500);
  key('ctrl+a'); key('Delete');
  await sleep(400);
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    type(lines[i], TYPE_MS);
    if (i < lines.length - 1) { key('Return'); key('shift+Home'); key('Delete'); await sleep(600); }
  }
  await sleep(800);
}
async function run(wait = 5000) {
  await clickEl(page, page.getByTestId('run'));
  await sleep(wait);
  const t = await terminal();
  log(`  terminal: ${JSON.stringify(t.slice(-160))}`);
  return t;
}
/** Read the lesson: wheel down and up over the lesson panel. */
async function read(ms) {
  // a fixed point inside the lesson panel: wheel events outside the window would switch openbox desktops
  const x = 270, y = 450;
  { const p = await screenOf(page, x, y); xdo('mousemove', '--sync', String(Math.round(p.x)), String(Math.round(p.y))); }
  const end = Date.now() + ms;
  let dir = 5;
  while (Date.now() < end) {
    await sleep(2500 + Math.random() * 1500);
    for (let i = 0; i < 3; i++) { xdo('click', dir > 0 ? '5' : '4'); await sleep(120); }
    dir = -dir * 1;
    if (Math.random() < 0.5) dir = -dir;
  }
}
async function go(locator, urlRe) {
  await clickEl(page, locator);
  await page.waitForURL(urlRe, { timeout: 30000 });
  await sleep(2500);
}
const lesson = (slug) => page.locator(`a[href="/sw/anza/misingi-ya-nuru/${slug}"]`).first();

await page.goto(NURU + '/sw');
await page.waitForLoadState('load');
await sleep(4000);
if (MODE !== 'off') {
  await waitFor(() => page.locator('toolbar-root').count(), 15000, 'toolbar host');
  // open the extension's menu once on the tab, as a reviewer does: it grants activeTab (D-185)
  key('ctrl+shift+y'); await sleep(2500); key('Escape'); await sleep(1500);
}

const m = await startMeasure({ label: MODE });
t0 = Date.now();
let recordingId = null;
try {
  step('home');
  await sleep(6000);
  if (MODE === 'trace') {
    step('start trace');
    key('ctrl+shift+period'); await sleep(700); key('x');
    recordingId = await waitFor(traceId, 20000, 'trace started');
    log('trace ' + recordingId);
    await sleep(2000);
  }
  step('L1 karibu');
  await go(page.getByRole('link', { name: 'Anza' }).first(), /\/karibu$/);
  await read(20000);
  await editor('andika("Habari, Nuru!")');
  await run();
  await sleep(4000);

  step('L2 andika');
  await go(page.getByTestId('next-nav'), /\/andika$/);
  await read(18000);
  await editor('andika("Jina langu ni Amani")\nandika("Ninajifunza Nuru" +)');
  await run(); // missing paren: parse error
  await sleep(3000);
  await editor('andika("Jina langu ni Amani")\nandika("Ninajifunza Nuru")');
  await run();
  await sleep(3000);

  step('L3 maoni');
  await go(page.getByTestId('next-nav'), /\/maoni$/);
  await read(15000);
  await editor('// hii ni maoni\nandika("Maoni hayaonekani")');
  await run();
  step('hint');
  await clickEl(page, page.getByTestId('hint-btn'));
  await sleep(6000);
  await clickEl(page, page.getByTestId('hint-btn')).catch(() => {});
  await sleep(2000);

  step('L4 vibadilika');
  await go(page.getByTestId('next-nav'), /\/vibadilika$/);
  await read(18000);
  await editor('fanya jina = "Amani"\nandika("Habari " + jna)');
  await run(); // undefined variable
  await sleep(3000);
  await editor('fanya jina = "Amani"\nandika("Habari " + jina)');
  await run();
  step('submit');
  await clickEl(page, page.getByTestId('submit'));
  await sleep(6000);
  await clickEl(page, page.getByRole('button', { name: 'Terminali' })).catch(() => {});
  await sleep(2000);

  step('L5 aina-za-data');
  await go(lesson('aina-za-data'), /\/aina-za-data$/);
  await read(15000);
  await editor('fanya a = 12\nfanya b = 5\nandika(a + b)\nandika(a * b)\nandika(a / b)');
  await run();
  await sleep(3000);

  step('dark mode toggle');
  await clickEl(page, page.getByRole('button', { name: /Badili kwenda/ }).first());
  await sleep(5000);
  await clickEl(page, page.getByRole('button', { name: /Badili kwenda/ }).first());
  await sleep(3000);

  step('L6 logic');
  await go(page.getByTestId('next-nav'), /\/logic$/);
  await read(15000);
  await editor('fanya x = 7\nandika(x > 5 && x < 10)');
  await run();
  await sleep(2000);

  step('L7 kama');
  await go(page.getByTestId('next-nav'), /\/kama$/);
  await read(15000);
  await editor('fanya alama = 72\nkama (alama > 50) {\nandika("Umefaulu")\n} sivyo {\nandika("Jaribu tena")\n}');
  await run();
  await sleep(3000);

  step('language EN and back');
  await go(page.getByText('EN', { exact: true }).first(), /\/en\//);
  await sleep(6000);
  await go(page.getByText('SW', { exact: true }).first(), /\/sw\//);
  await sleep(3000);

  step('L8 jaza');
  await go(page.getByTestId('next-nav'), /\/jaza$/);
  await read(12000);
  await editor('fanya jina = jaza("Jina lako ni nani? ")\nandika("Karibu, " + jina)');
  await run(3000);
  type('Amani', 200); key('Return');
  await sleep(3000);
  log(`  terminal: ${JSON.stringify((await terminal()).slice(-120))}`);

  step('reload');
  key('ctrl+r');
  await page.waitForLoadState('load');
  await sleep(5000);

  step('L9 safu');
  await go(page.getByTestId('next-nav'), /\/safu$/);
  await read(15000);
  await editor('fanya matunda = ["embe", "ndizi", "papai"]\nandika(matunda[1])');
  await run();

  step('L10 kwa');
  await go(page.getByTestId('next-nav'), /\/kwa$/);
  await read(12000);
  await editor('kwa i ktk mfululizo(5) {\nandika(i * i)\n}');
  await run();

  step('idle reading until 10 min');
  while (Date.now() - t0 < TOTAL - 8000) await read(Math.min(15000, TOTAL - 8000 - (Date.now() - t0)));
} catch (e) {
  log('FAILED: ' + e.message);
  xshot(`${OUT}/failed.png`);
}
let stopInfo = {};
if (MODE === 'trace' && recordingId) {
  step('stop trace');
  const ts = Date.now();
  // blur the editor first so x reaches the toolbar
  const h = await page.locator('h1').first().boundingBox();
  await clickAt(page, h.x + 5, h.y - 18);
  await sleep(400);
  key('x');
  await waitFor(async () => !(await traceId()), 120000, 'trace stopped');
  stopInfo = { stopMs: Date.now() - ts };
}
const res = await m.stop({ marks, recordingId, ...stopInfo });
if (sw) res.extStats = await sw.evaluate(() => (globalThis.__tb ? 'hooks' : 'release')).catch(() => null);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(res, null, 1));
log(`[${MODE}] done in ${res.seconds}s, wrote ${OUT}/result.json`);
await browser.close();
