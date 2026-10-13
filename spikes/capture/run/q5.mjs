// Q5: captureVisibleTab + crop to an element rect at DPR 1, DPR 2, and DPR 1 with 150% page zoom.
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { launch, sleep, saveFile, OUT } from './launch.mjs';

const SEL = '[data-testid=hidden-500]';
const dims = (f) => execFileSync('magick', ['identify', '-format', '%wx%h', f]).toString();
// compare prints the count of differing pixels on stderr and exits 1 when any differ.
const diff = (a, b) => spawnSync('magick', ['compare', '-metric', 'AE', '-fuzz', '10%', a, b, 'null:']).stderr.toString().trim();

for (const [dpr, zoom] of [[1, 1], [2, 1], [1, 1.5]]) {
  const tag = `dpr${dpr}-zoom${zoom}`;
  const { context, sw } = await launch({ dpr });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('http://localhost:5173/');
  await page.waitForSelector(SEL);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  if (zoom !== 1) await sw.evaluate(([id, z]) => chrome.tabs.setZoom(id, z), [tabId, zoom]);
  await sleep(800);
  const info = await sw.evaluate(([id, sel, name]) => globalThis.__spike.cropElement(id, sel, name), [tabId, SEL, `crop-${tag}.png`]);
  const crop = await saveFile(sw, `crop-${tag}.png`);
  await saveFile(sw, `full-crop-${tag}.png`);
  const ref = path.join(OUT, `ref-${tag}.png`);
  await page.locator(SEL).screenshot({ path: ref }); // Playwright's own element shot, device scale
  console.log(`\n== ${tag} ==`);
  console.log('rect (CSS px)', JSON.stringify(info.rect), '\nbitmap', info.bitmap.join('x'), 'scale used', info.scale, 'crop [sx,sy,sw,sh]', info.crop.join(','));
  console.log('crop file', dims(crop), '| Playwright element screenshot', dims(ref), '| pixels differing (fuzz 10%):', diff(crop, ref));
  await context.close();
}
