import { connect, sleep, SERVER, log } from './drv.mjs';
const OUT = '/home/dev/demo-run/shots';
const [,, what, url, name, scheme = 'light', extra = ''] = process.argv;
const { browser, ctx } = await connect();
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ colorScheme: scheme });
await page.goto(SERVER + url); await page.waitForLoadState('networkidle').catch(() => {});
await sleep(2500);
if (extra) { for (const step of extra.split(';')) { const [k, v] = step.split('='); if (k === 'tab') await page.getByRole('tab', { name: v }).first().click().catch(e => log('tab fail ' + e.message)); if (k === 'click') await page.locator(v).first().click().catch(e => log('click fail ' + e.message)); if (k === 'wait') await sleep(Number(v)); } await sleep(1200); }
await page.screenshot({ path: `${OUT}/${name}.png` });
log(`${what} ${page.url()} -> ${name}.png`);
await page.close(); await browser.close();
