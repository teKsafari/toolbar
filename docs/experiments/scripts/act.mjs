// Experiment 2: one real action on Nuru, then what a reviewer with DevTools open sees.
// node act.mjs <n> '<action json>' [waitMs]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connect, clickEl, clickAt, screenOf, key, type, sleep, xdo, NURU } from './drv.mjs';

const [n, spec, waitArg] = process.argv.slice(2);
const a = JSON.parse(spec);
const wait = Number(waitArg ?? 4000);
const DIR = process.env.EXP_DIR ?? '/home/dev/nuru-exp/exp2';
fs.mkdirSync(DIR, { recursive: true });
const { browser, ctx } = await connect();
const page = ctx.pages().find((p) => p.url().startsWith(NURU));
const shot = (f) => execFileSync('import', ['-window', 'root', f], { env: { ...process.env, DISPLAY: ':262' } });
const terminal = () => page.evaluate(() => [...document.querySelectorAll('div.break-words.whitespace-pre-wrap')].map((e) => e.innerText).join(' | ')).catch(() => '?');
const seen = { console: [], requests: [] };
const t0 = Date.now();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') seen.console.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${m.type()}: ${m.text().slice(0, 160)}`); });
page.on('pageerror', (e) => seen.console.push(`${((Date.now() - t0) / 1000).toFixed(1)}s pageerror: ${e.message.slice(0, 160)}`));
const reqT = new Map();
page.on('request', (r) => reqT.set(r, Date.now()));
page.on('requestfinished', async (r) => { const res = await r.response().catch(() => null); seen.requests.push(`${((reqT.get(r) - t0) / 1000).toFixed(1)}s ${r.method()} ${r.url().replace(NURU, '').slice(0, 90)} ${res?.status()} ${Date.now() - reqT.get(r)}ms`); });
page.on('requestfailed', (r) => seen.requests.push(`${((reqT.get(r) - t0) / 1000).toFixed(1)}s ${r.method()} ${r.url().replace(NURU, '').slice(0, 90)} FAILED ${r.failure()?.errorText}`));
const urlBefore = page.url();
const termBefore = await terminal();
shot(`${DIR}/${n}-before.png`);
const loc = (x) => x.testid ? page.getByTestId(x.testid).first() : x.role ? page.getByRole(x.role, { name: x.name, exact: !!x.exact }).first() : x.text ? page.getByText(x.text, { exact: true }).first() : page.locator(x.css).first();
let tAct = null;
const cdp = a.net ? await ctx.newCDPSession(page) : null;
if (a.net) await cdp.send('Network.emulateNetworkConditions', a.net);
switch (a.do) {
  case 'click': {
    if (a.xy) { const p = await screenOf(page, a.xy[0], a.xy[1]); xdo('mousemove', '--sync', String(Math.round(p.x)), String(Math.round(p.y))); await sleep(300); tAct = Date.now(); xdo('click', '1'); }
    else { const l = loc(a); await l.scrollIntoViewIfNeeded().catch(() => {}); const b = await l.boundingBox(); const p = await screenOf(page, b.x + b.width / 2 + (a.dx ?? 0), b.y + b.height / 2); xdo('mousemove', '--sync', String(Math.round(p.x)), String(Math.round(p.y))); await sleep(300); tAct = Date.now(); xdo('click', '1'); }
    break;
  }
  case 'editor': {
    await clickEl(page, page.getByTestId('editor').locator('.cm-content'));
    await sleep(300); key('ctrl+a'); key('Delete');
    const lines = a.code.split('\n');
    tAct = Date.now();
    for (let i = 0; i < lines.length; i++) { type(lines[i], 90); if (i < lines.length - 1) { key('Return'); key('shift+Home'); key('Delete'); } }
    break;
  }
  case 'type': tAct = Date.now(); type(a.text, 120); break;
  case 'key': tAct = Date.now(); key(...a.keys); break;
}
await sleep(wait);
if (a.net && a.restore !== false) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
shot(`${DIR}/${n}-after.png`);
execFileSync('magick', [`${DIR}/${n}-before.png`, `${DIR}/${n}-after.png`, '-resize', '50%', '+append', `${DIR}/${n}-pair.png`]);
const rec = { n: Number(n), action: a, tAct, wait, urlBefore: urlBefore.replace(NURU, ''), urlAfter: page.url().replace(NURU, ''), termBefore: termBefore.slice(-200), termAfter: (await terminal()).slice(-200), ...seen };
fs.appendFileSync(`${DIR}/actions.jsonl`, JSON.stringify(rec) + '\n');
console.log(JSON.stringify(rec, null, 1));
await browser.close();
