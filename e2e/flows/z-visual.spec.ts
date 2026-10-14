// Visual pass: the web pages and the extension pages at 1440 and 390 px, light and dark.
// Screenshots land in e2e/flows-shots/visual-*.png for a person to look at; the test
// checks what a machine can: no sideways scroll, nothing wider than the screen, the theme applied.
import { chromium, type Page } from '@playwright/test';
import { EXT_ID, LAB_URL, SERVER, chord, editorFrame, expect, hydrated, labPage, saveShot, test } from './fixture.ts';
import { instantReplay, recordLabErrors } from './journeys.ts';

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

/** Elements wider than the viewport that are not inside a scroll container. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.scrollingElement && document.scrollingElement.scrollWidth > vw + 1) out.push(`page scrollWidth ${document.scrollingElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      let p: HTMLElement | null = el.parentElement;
      let clipped = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
          clipped = true;
          break;
        }
        p = p.parentElement;
      }
      if (!clipped && getComputedStyle(el).position !== 'fixed') out.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} right ${Math.round(r.right)}`);
      if (out.length > 5) break;
    }
    return out;
  });
}

async function look(page: Page, name: string, theme: 'light' | 'dark') {
  // set again after each navigation: in the extension's persistent context a navigation can
  // drop the emulated colour scheme
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForTimeout(400);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const why = await page.evaluate(() => `data-theme=${document.documentElement.getAttribute('data-theme')} media-dark=${matchMedia('(prefers-color-scheme: dark)').matches} stored=${localStorage.getItem('nib.theme')}`);
  const [r, g, b] = (bg.match(/\d+/g) ?? ['255', '255', '255']).map(Number) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (bg !== 'rgba(0, 0, 0, 0)') expect(theme === 'dark' ? lum < 80 : lum > 180, `${name}: body ${bg} in ${theme} (${why})`).toBe(true);
  expect(await overflow(page), `${name} overflows`).toEqual([]);
  await page.screenshot({ path: saveShot(`visual-${name}`), fullPage: false });
}

test('visual: web pages at 1440 and 390, light and dark', async ({ nib, context }) => {
  const video = await recordLabErrors(nib);
  const replay = await instantReplay(nib);
  const shot = nib.made.screenshot;
  const member: [string, string][] = [
    ['dashboard', '/'],
    ['capture-video', `/c/${video.id}`],
    ['capture-replay', `/c/${replay.id}`],
    ['settings', '/settings/profile'],
    ['settings-mcp', '/settings/mcp'],
    ['settings-browsers', '/settings/browsers'],
    ...(shot ? ([['capture-screenshot', `/c/${shot.id}`]] as [string, string][]) : []),
  ];
  const anon = await chromium.launch();
  for (const size of SIZES)
    for (const theme of THEMES) {
      const page = await context.newPage();
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme });
      for (const [name, p] of member) {
        await page.goto(SERVER + p);
        await hydrated(page);
        await look(page, `${name}-${size.name}-${theme}`, theme);
      }
      await page.close();
      const out = await anon.newPage({ viewport: { width: size.width, height: size.height }, colorScheme: theme });
      await out.goto(`${SERVER}/login`);
      await hydrated(out);
      await look(out, `login-${size.name}-${theme}`, theme);
      await out.goto(video.shareUrl);
      await hydrated(out);
      await look(out, `share-${size.name}-${theme}`, theme);
      await out.close();
    }
  await anon.close();
});

test('visual: popup, options and the editor, light and dark', async ({ nib, context }) => {
  void nib;
  for (const theme of THEMES) {
    const lab = await labPage(context);
    await lab.emulateMedia({ colorScheme: theme });
    const tabId = await (await nib.sw()).evaluate(async (u) => (await chrome.tabs.query({ url: `${u}/*` })).at(-1)?.id ?? -1, LAB_URL);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 }); // Chrome sizes the popup to its 400 px content
    await popup.emulateMedia({ colorScheme: theme });
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html?tabId=${tabId}`);
    await popup.locator('[data-popup][data-loading="false"]').waitFor();
    await look(popup, `popup-${theme}`, theme);
    await popup.getByRole('button', { name: 'Menu' }).click();
    await popup.waitForTimeout(200);
    await popup.screenshot({ path: saveShot(`visual-popup-menu-${theme}`) });
    await popup.keyboard.press('Escape');
    await popup.goto(`chrome-extension://${EXT_ID}/options.html`);
    await popup.setViewportSize({ width: 1440, height: 900 });
    await look(popup, `options-${theme}`, theme);
    await popup.close();

    // the editor over the lab page, after a real screenshot
    await chord(lab, 'ctrl+shift+s');
    await lab.waitForTimeout(300);
    await lab.mouse.move(300, 300);
    await lab.mouse.click(310, 305);
    const f = await editorFrame(lab);
    await lab.waitForTimeout(500);
    await lab.screenshot({ path: saveShot(`visual-editor-${theme}`) });
    await f.getByRole('button', { name: /Share link/ }).first().click().catch(() => undefined);
    await lab.waitForTimeout(200);
    await lab.screenshot({ path: saveShot(`visual-editor-menu-${theme}`) });
    await lab.keyboard.press('Escape');
    await lab.close();
  }
});
