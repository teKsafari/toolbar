// Entry of the page bundle the injector serves as /__toolbar/toolbar.js (D-158). The injector puts
// it first in <head> as a classic script, so it runs before the app's own scripts, as the
// extension's document_start content scripts do. The same capture code runs here: the MAIN-world
// hooks and the isolated-world recorder from @toolbar/capture, both in the page's realm and joined
// by their usual MessageChannel bridge, with PageSession as the Transport. The UI mounts in an
// open shadow root on <toolbar-root>, which rrweb and the capture hooks already leave out.
import { mount } from 'svelte';
import { startMainWorld } from '@toolbar/capture/main';
import { startIsolatedWorld } from '@toolbar/capture/isolated';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import { bodyPolicyOf, projectForUrl } from '@toolbar/shared/projects';
import { completeLocator, createRouteTables } from '@toolbar/shared/locator-complete';
import { createStackMapper, type FetchedText } from '@toolbar/shared/sourcemap';
import type { LocatorPacket } from '@toolbar/shared/locator';
import tokens from '@toolbar/ui/tokens.shadow.css?inline';
import { registerFonts } from '@toolbar/ui/fonts';
import css from './style.css?inline';
import Toolbar from './Toolbar.svelte';
import { PageSession } from './session.ts';
import { RELAY, createPageClient, type Bootstrap } from './upload.ts';

const BOOTED = Symbol.for('open-toolbar.page');

function boot() {
  const w = window as unknown as Record<symbol, unknown>;
  if (w[BOOTED] || window.top !== window) return;
  Object.defineProperty(window, BOOTED, { value: true });

  // Saved before the hooks wrap fetch, so uploads do not show up in the reviewer's network log.
  const nativeFetch = window.fetch.bind(window);
  startMainWorld();

  const client = createPageClient(nativeFetch);
  let pending: Promise<Bootstrap> | null = null;
  const bootstrap = () =>
    (pending ??= client.bootstrap().catch((e: unknown) => {
      pending = null;
      throw e;
    }));
  // The page's project (D-123) names the masking preset, the body policy and the workspace a
  // capture goes to. Events wait in the isolated world until the preset is known (D-125); without
  // a project the site's own reviewer gets the staging preset.
  const projectOfPage = async () => {
    const b = await bootstrap();
    return { b, project: projectForUrl(b.projects ?? [], location.href) };
  };
  let configured: Promise<void> | null = null;
  const ensureConfig = () =>
    (configured ??= projectOfPage().then(
      ({ project }) =>
        session.command({
          type: 'config',
          maskingPreset: project?.maskingPreset ?? 'staging',
          // no project: staging rules, bodies of the page's own origin only
          bodyPolicy: project ? bodyPolicyOf(project) : { preset: 'staging', origins: [], allowlist: [] },
        }),
      (e: unknown) => {
        configured = null;
        throw e;
      },
    ));
  let iso: ReturnType<typeof startIsolatedWorld> | null = null;
  const session = new PageSession({
    client,
    workspaceId: async () => {
      await ensureConfig();
      const { b, project } = await projectOfPage();
      const id = project?.workspaceId ?? b.activeWorkspaceId ?? b.workspaces[0]?.id;
      if (!id) throw new Error('no_workspace');
      return id;
    },
    env: () => (iso ? iso.env() : Promise.reject(new Error('not started'))),
  });
  iso = startIsolatedWorld({ transport: session, awaitConfig: true });
  session.boot();
  ensureConfig().catch(() => {
    /* signed out or offline: events stay held; the next comment or trace tries again */
  });

  // Locator packets for comments (D-164): the page's part from the isolated world (Svelte dev
  // source through the MAIN-world listener), route files from the app's SvelteKit route table and
  // the last minute's errors mapped through the app's source maps, all read with the saved fetch
  // so they stay out of the network log.
  const fetchText = async (url: string): Promise<FetchedText | null> => {
    try {
      const res = await nativeFetch(url, { credentials: 'same-origin', cache: 'force-cache' });
      if (!res.ok) return null;
      const headers: Record<string, string> = {};
      for (const k of ['sourcemap', 'x-sourcemap', 'content-type']) {
        const v = res.headers.get(k);
        if (v) headers[k] = v;
      }
      return { text: await res.text(), headers };
    } catch {
      return null;
    }
  };
  const routes = createRouteTables(fetchText, 8);
  const mapper = createStackMapper({ fetchText });
  const locate = async (at: { x: number; y: number }): Promise<LocatorPacket | undefined> => {
    try {
      await ensureConfig().catch(() => undefined); // the masking preset shapes the packet
      if (!iso) return undefined;
      const page = await iso.locate({ kind: 'element', at });
      return await completeLocator(page, { routes, mapper, events: session.recentEvents(60_000) });
    } catch {
      return undefined;
    }
  };

  const mountUi = () => {
    const host = document.createElement(UI_HOST_TAG);
    const shadow = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(tokens + '\n' + css);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      /* very old browser: unstyled but usable */
    }
    const target = document.createElement('div');
    shadow.appendChild(target);
    // Keys typed into the toolbar stay out of the page's shortcuts.
    for (const t of ['keydown', 'keyup', 'keypress'] as const) target.addEventListener(t, (e) => e.stopPropagation());
    document.documentElement.appendChild(host);
    // the bundled faces (D-175), served by the injector next to the bundle; @font-face does not
    // apply inside a shadow root, so they go on the page's document under their tb-* names
    registerFonts(document, (f) => `${RELAY}/${f}`);
    mount(Toolbar, { target, props: { session, bootstrap, host, locate } });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountUi, { once: true });
  else mountUi();
}

try {
  boot();
} catch {
  /* never break the page */
}
