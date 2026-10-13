// Q4: closed shadow root UI. Page CSS isolation, and how Playwright can drive it.
import { launch, sleep, getLog } from './launch.mjs';

const HOSTILE_CSS = `
  body { color: rgb(255, 0, 0) !important; font-family: monospace !important; letter-spacing: 5px !important; }
  * { color: rgb(255, 0, 0) !important; }
  button { background: rgb(0, 255, 0) !important; font-size: 40px !important; }
  toolbar-root, toolbar-noreset { display: none !important; }
  #tb-btn, .txt { background: rgb(0, 0, 255) !important; }
`;

for (const openShadow of [false, true]) {
  const label = openShadow ? 'TEST build (open root)' : 'RELEASE build (closed root)';
  const { context, sw } = await launch({ openShadow });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('toolbar-root', { state: 'attached' });
  await page.addStyleTag({ content: HOSTILE_CSS });
  await sleep(300);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  const probe = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'probe-ui' }), tabId);
  console.log(`\n===== ${label} =====`);
  console.log('styles seen from inside the shadow root, with hostile page CSS applied:');
  console.log(JSON.stringify(probe, null, 1));

  console.log('page: host.shadowRoot is', await page.evaluate(() => String(document.querySelector('toolbar-root').shadowRoot)));
  const n = await page.locator('toolbar-root #tb-btn').count();
  console.log('Playwright locator("toolbar-root #tb-btn").count() =', n);
  if (n) {
    await page.locator('toolbar-root #tb-btn').click();
    console.log('clicked through the locator');
  } else {
    // Release build: CDP DOM with pierce:true still reaches closed roots.
    const cdp = await context.newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (node) => {
      if (node.nodeName === 'TOOLBAR-ROOT') return node;
      for (const c of node.children ?? []) { const f = find(c); if (f) return f; }
      return null;
    };
    const host = find(root);
    const sr = host.shadowRoots?.[0];
    console.log('CDP pierce: host found =', !!host, 'shadowRootType =', sr?.shadowRootType);
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: sr.nodeId, selector: '#tb-btn' });
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
    console.log('clicked via CDP box model + page.mouse at', (x1 + x3) / 2, (y1 + y3) / 2);
  }
  await sleep(500);
  console.log('extension log:', (await getLog(sw)).filter((l) => l.includes('ui click')));
  await context.close();
}
