// Q2 / S2: screen recording. Usage: node run/q2.mjs <offscreen|desktop|window> [auto|fakeui]
//   auto   -> --auto-select-desktop-capture-source="Entire screen"
//   fakeui -> --use-fake-ui-for-media-stream
// Without a flag the script screenshots the picker and saves it, then tries PICK_X/PICK_Y clicks if given.
import { launch, x, shot, sleep, saveFile, ffprobe, lastPts, getLog, EXT_ID } from './launch.mjs';

const [mode, flag] = process.argv.slice(2);
const args = [];
if (flag === 'auto') args.push('--auto-select-desktop-capture-source=Entire screen');
if (flag === 'fakeui') args.push('--use-fake-ui-for-media-stream');
if (flag === 'fakeboth') args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
const { context, sw } = await launch({ args });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('http://localhost:5173/');
const tag = `${mode}-${flag ?? 'noflag'}`;
console.log('variant', tag, args);

let file;
if (mode === 'offscreen') {
  const p = sw.evaluate(() => globalThis.__spike.screenViaOffscreenGDM(3000));
  let r = await Promise.race([p, sleep(8000).then(() => 'pending after 8 s')]);
  console.log('offscreen getDisplayMedia ->', JSON.stringify(r));
  shot(`q2-${tag}.png`);
  if (r === 'pending after 8 s' && process.env.PICK) {
    for (const xy of process.env.PICK.split(';')) {
      const [px, py] = xy.split(',');
      x('mousemove', px, py, 'click', '1');
      await sleep(1500);
      shot(`q2-${tag}-after-${px}-${py}.png`);
    }
    r = await Promise.race([p, sleep(20000).then(() => 'still pending')]);
    console.log('after clicks ->', JSON.stringify(r));
  }
  if (r?.ok) file = await saveFile(sw, 'screen-offscreen-gdm.webm', `screen-${tag}.webm`);
} else if (mode === 'desktop') {
  const p = sw.evaluate(() => globalThis.__spike.screenViaDesktopCapture(3000));
  let r = await Promise.race([p, sleep(5000).then(() => 'pending after 5 s')]);
  console.log('desktopCapture ->', JSON.stringify(r));
  shot(`q2-${tag}.png`);
  if (r === 'pending after 5 s' && process.env.PICK) {
    for (const xy of process.env.PICK.split(';')) {
      const [px, py] = xy.split(',');
      x('mousemove', px, py, 'click', '1');
      await sleep(1000);
      shot(`q2-${tag}-after-${px}-${py}.png`);
    }
    r = await Promise.race([p, sleep(15000).then(() => 'still pending')]);
    console.log('after clicks ->', JSON.stringify(r));
  }
  if (r?.ok) file = await saveFile(sw, 'screen-desktopcapture.webm', `screen-${tag}.webm`);
} else if (mode === 'window') {
  const w = await context.newPage();
  await w.goto(`chrome-extension://${EXT_ID}/screen.html`);
  await w.click('#go');
  await sleep(4000);
  shot(`q2-${tag}.png`);
  console.log('window page status after 4 s:', await w.textContent('#out'));
  if (process.env.PICK) {
    for (const xy of process.env.PICK.split(';')) {
      const [px, py] = xy.split(',');
      x('mousemove', px, py, 'click', '1');
      await sleep(1000);
      shot(`q2-${tag}-after-${px}-${py}.png`);
    }
  }
  await w.waitForFunction(() => /bytes|ERROR/.test(document.querySelector('#out').textContent), null, { timeout: 30000 }).catch(() => {});
  const status = await w.textContent('#out');
  console.log('window page status:', status);
  if (status.includes('bytes')) file = await saveFile(sw, 'screen-window-gdm.webm', `screen-${tag}.webm`);
}
if (file) console.log('ffprobe', ffprobe(file), '\nlast video pts', lastPts(file));
console.log('--- extension log ---\n' + (await getLog(sw)).join('\n'));
await context.close();
