// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { installLocatorMain, readKitGlobal, readSvelteMeta, type LocateReply } from '../src/locator-main.ts';
import { createLocateMain, dispatchLocate, findKitEntries, locateInPage } from '../src/locator.ts';

const PAGE = `
<header><nav aria-label="Main"><a href="/">Home</a></nav></header>
<main>
  <section>
    <h2>Requests and errors</h2>
    <p>intro</p>
    <button data-testid="throws" id="profile" class="btn primary svelte-abc">Show profile (throws)</button>
  </section>
</main>`;

function setup(html = PAGE) {
  document.title = 'Lab: errors';
  document.body.innerHTML = html;
  return document.querySelector('button')!;
}

/** Wires a MAIN listener and the isolated sender in one window, as the bridge would. */
function wire() {
  const waiting = new Map<number, (r: LocateReply) => void>();
  let id = 0;
  installLocatorMain(window, { post: (m) => waiting.get((m as LocateReply).id)?.(m as LocateReply) });
  return createLocateMain({ send: dispatchLocate }, waiting, () => ++id);
}
const locateMain = wire();

describe('svelte meta', () => {
  it('reads Svelte 5 meta with its component chain, from an ancestor when needed', () => {
    const btn = setup();
    const section = btn.closest('section')!;
    (section as unknown as Record<string, unknown>).__svelte_meta = {
      loc: { file: 'src/routes/+page.svelte', line: 95, column: 1 },
      parent: { type: 'component', file: 'src/routes/+layout.svelte', line: 12, column: 2, componentTag: 'Page', parent: null },
    };
    expect(readSvelteMeta(btn)).toEqual({
      file: 'src/routes/+page.svelte',
      line: 95,
      column: 1,
      depth: 1,
      version: 5,
      chain: [{ type: 'component', file: 'src/routes/+layout.svelte', line: 12, column: 2, tag: 'Page' }],
    });
  });

  it('turns Svelte 4 zero-based lines into one-based', () => {
    const btn = setup();
    (btn as unknown as Record<string, unknown>).__svelte_meta = { loc: { file: 'src/App.svelte', line: 9, column: 4, char: 120 } };
    expect(readSvelteMeta(btn)).toMatchObject({ file: 'src/App.svelte', line: 10, column: 4, depth: 0, version: 4, chain: [] });
  });

  it('is null on apps without meta, and finds the SvelteKit global', () => {
    expect(readSvelteMeta(setup())).toBeNull();
    expect(readKitGlobal(window)).toBeNull();
    (window as unknown as Record<string, unknown>).__sveltekit_1x2y = { base: '/docs' };
    expect(readKitGlobal(window)).toEqual({ base: '/docs' });
    delete (window as unknown as Record<string, unknown>).__sveltekit_1x2y;
  });
});

describe('locateInPage', () => {
  it('describes an element by selector, with landmarks, heading and guessed route files', async () => {
    setup();
    const { packet, cropRect, kitEntries } = await locateInPage({ selector: '[data-testid="throws"]' }, { locateMain, now: () => 5 });
    expect(packet).toMatchObject({
      v: 1,
      kind: 'element',
      at: 5,
      title: 'Lab: errors',
      selector: '#profile',
      tag: 'button',
      role: 'button',
      name: 'Show profile (throws)',
      text: 'Show profile (throws)',
      testId: 'throws',
      elId: 'profile',
      classes: ['btn', 'primary'],
      landmarks: ['main'],
      heading: 'Requests and errors',
      masking: 'staging',
    });
    expect(packet.routeFiles[0]).toMatchObject({ file: 'src/routes/+page.svelte', source: 'guess' });
    expect(packet.source).toBeUndefined();
    expect(kitEntries).toEqual([]);
    expect(cropRect === null || typeof cropRect.w === 'number').toBe(true);
  });

  it('gets the dev file and line from the MAIN world over a DOM event', async () => {
    const btn = setup();
    (btn as unknown as Record<string, unknown>).__svelte_meta = {
      loc: { file: 'src/routes/+page.svelte', line: 101, column: 2 },
      parent: { type: 'component', file: 'src/routes/+layout.svelte', line: 8, column: 0, componentTag: 'Page', parent: null },
    };
    let pageSaw = 0;
    window.addEventListener('__tb:locate', () => pageSaw++);
    const { packet } = await locateInPage({ selector: 'button' }, { locateMain });
    expect(packet.source).toEqual({ file: 'src/routes/+page.svelte', line: 101, column: 2, via: 'svelte-meta', depth: 0 });
    expect(packet.components).toEqual([{ type: 'component', file: 'src/routes/+layout.svelte', line: 8, column: 0, tag: 'Page' }]);
    expect(packet.framework).toMatchObject({ name: 'svelte', dev: true });
    expect(packet.routeFiles[0]).toEqual({ file: 'src/routes/+page.svelte', routeId: '/', role: 'page', source: 'svelte-meta' });
    expect(pageSaw).toBe(0); // the MAIN listener hides the request from the page
  });

  it('masks text, name, heading and title under the production preset', async () => {
    setup();
    const { packet } = await locateInPage({ selector: 'button' }, { preset: 'production', locateMain });
    expect(packet).toMatchObject({ masking: 'production', testId: 'throws', role: 'button' });
    expect(packet.text).toBeUndefined();
    expect(packet.name).toBeUndefined();
    expect(packet.heading).toBeUndefined();
    expect(packet.title).toBeUndefined();
  });

  it('falls back to a page packet when nothing matches', async () => {
    setup();
    const { packet, cropRect } = await locateInPage({ selector: '#nope' }, { locateMain });
    expect(packet.kind).toBe('page');
    expect(packet.selector).toBeUndefined();
    expect(cropRect).toBeNull();
  });

  it('lists SvelteKit entry modules from preload links and inline imports', () => {
    document.head.innerHTML = '<link rel="modulepreload" href="/docs/_app/immutable/entry/app.70RGvCJo.js"><link rel="modulepreload" href="/docs/_app/immutable/chunks/x.js">';
    document.body.innerHTML = '<script>import("/@fs/home/x/lab/.svelte-kit/generated/dev/client/app.js").then(() => {})</script>';
    expect(findKitEntries(document).map((u) => new URL(u).pathname)).toEqual(['/docs/_app/immutable/entry/app.70RGvCJo.js', '/@fs/home/x/lab/.svelte-kit/generated/dev/client/app.js']);
    document.head.innerHTML = '';
  });
});
