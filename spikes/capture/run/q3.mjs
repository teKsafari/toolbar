// Q3: MAIN-world document_start hooks vs the lab's first script; events relayed to the isolated world.
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep, OUT } from './launch.mjs';

const { context, sw } = await launch();
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('http://localhost:5173/');
await page.waitForSelector('[data-testid=console]');
await sleep(1000);
const firstScript = await page.evaluate(() => {
  const s = document.scripts[0];
  return s ? { type: s.type, src: s.src, inline: s.src ? null : s.textContent.slice(0, 80) } : null;
});
await sw.evaluate(() => globalThis.__spike.clearEvents());
const before = await page.evaluate(() => ({
  fetchToString: String(window.fetch).slice(0, 120),
  consoleLogToString: String(console.log),
  sveltekitGlobalsNow: Object.keys(window).filter((k) => k.startsWith('__sveltekit')),
}));

// Snapshot of what was captured during page load (boot + vite client logs) is read before clearing below.
await page.click('[data-testid=console]');
await page.click('[data-testid=hidden-500]');
await page.waitForFunction(() => document.querySelector('[data-testid=status]').textContent === 'saved');
await sleep(1500);
const events = await sw.evaluate(() => globalThis.__spike.getEvents());
fs.writeFileSync(path.join(OUT, 'q3-events.json'), JSON.stringify(events, null, 2));

// Reload to capture the boot event cleanly from the very start of a document.
await sw.evaluate(() => globalThis.__spike.clearEvents());
await page.reload();
await page.waitForSelector('[data-testid=console]');
await sleep(1500);
const bootEvents = await sw.evaluate(() => globalThis.__spike.getEvents());
fs.writeFileSync(path.join(OUT, 'q3-boot-events.json'), JSON.stringify(bootEvents, null, 2));

console.log('first <script> in the lab page:', JSON.stringify(firstScript));
console.log('fetch after hooks:', JSON.stringify(before));
console.log('\n== boot (from reload) ==');
for (const e of bootEvents.slice(0, 8)) console.log(JSON.stringify(e).slice(0, 300));
console.log('\n== after clicking "Log at every level" and "Submit order (hidden 500)" ==');
for (const e of events) {
  const brief = { kind: e.kind, level: e.level, via: e.via, args: e.args && JSON.stringify(e.args).slice(0, 110), method: e.method, url: e.url, status: e.status, ok: e.ok, body: e.body?.slice(0, 120) };
  console.log(JSON.stringify(Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== undefined))));
}
await context.close();
