// The embed (D-210 to D-212): the reviewer toolbar on a site that added it, for reviewers without
// the extension. It runs the extension's capture code in the page's realm: the MAIN-world hooks
// and the isolated-world recorder from @toolbar/capture, joined by their usual MessageChannel
// bridge, with PageSession as the Transport. As a script tag first in <head> it runs before the
// app's own scripts, as the extension's document_start content scripts do; through init() it
// starts where the app calls it. The project's public key fetches the config (masking preset,
// body policy, brand); a key that is unknown, turned off or used on another origin gets one
// console line and no UI. The UI is the shared reviewer toolbar (@toolbar/review) in an open
// shadow root on <toolbar-root>, which rrweb and the capture hooks already leave out, styled by
// constructed style sheets so a CSP without 'unsafe-inline' styles still renders it.
import { mount } from 'svelte';
import { startMainWorld } from '@toolbar/capture/main';
import { startIsolatedWorld } from '@toolbar/capture/isolated';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import { completeLocator, createRouteTables } from '@toolbar/shared/locator-complete';
import { createStackMapper, type FetchedText } from '@toolbar/shared/sourcemap';
import type { LocatorPacket } from '@toolbar/shared/locator';
import type { LocatorTarget } from '@toolbar/shared/ext';
import tokens from '@toolbar/ui/tokens.shadow.css?inline';
import { registerFonts } from '@toolbar/ui/fonts';
import { review } from '@toolbar/review';
import { setPlatform } from '@toolbar/review/platform';
import { adoptStyles } from './css.ts';
import App from './App.svelte';
import { PageSession } from './session.ts';
import { EmbedHttpError, createEmbedClient, type EmbedConfig } from './client.ts';
import { createPagePlatform } from './platform.ts';
import { ReviewerStore } from './reviewer.ts';
import { createShooter } from './shot.ts';

export interface InitOptions {
  /** the project's embed key, `tbk_...` (Settings, Projects) */
  key: string;
  /** the open-toolbar server, for example `https://toolbar.example.com` */
  server: string;
  /** the signed-in person of the app, when it knows them: the composer then does not ask */
  user?: ReviewerUser;
}

export interface OpenToolbarApi {
  /** show the toolbar again after its X closed it on this site */
  show(): void;
  /** close it on this site, as its X does (a running trace keeps running) */
  hide(): void;
  /** name the reviewer again, as init's `user` does: the app's signed-in person changed */
  setUser(user: ReviewerUser): void;
}

/** The app's signed-in person; a field left out is no longer known. */
export type ReviewerUser = { name?: string; email?: string };

declare global {
  interface Window {
    openToolbar?: OpenToolbarApi;
  }
}

const BOOTED = Symbol.for('open-toolbar.embed');
/** The started toolbar's reviewer, or the user named before init ran. */
let named: { user: ReviewerUser | null; apply: ((u: ReviewerUser) => void) | null } = { user: null, apply: null };
/** `?open-toolbar` in the page URL shows a toolbar the reviewer closed on this site. */
export const SHOW_PARAM = 'open-toolbar';

/**
 * The shadow host: a fixed, zero-size box the page cannot hide or move, so children can use
 * position: fixed against the viewport.
 */
const HOST_CSS = `:host {
  all: initial !important; display: block !important; position: fixed !important; top: 0 !important; left: 0 !important;
  width: 0 !important; height: 0 !important; overflow: visible !important;
  z-index: 2147483647 !important; pointer-events: none !important;
}`;

function inIframe(): boolean {
  try {
    return window.top !== window;
  } catch {
    return true;
  }
}

/** Absolute http(s) origin of the server, or null. */
export function serverOrigin(server: string): string | null {
  try {
    const u = new URL(server);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin + u.pathname.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * Name the reviewer: the app's signed-in person, who changed after init (sign-in, sign-out). The
 * name and email go with the next note or trace; a name the reviewer typed in the composer stays
 * first. Before init it waits for it; during server rendering it does nothing.
 */
export function setUser(user: ReviewerUser): void {
  const u = { name: user?.name, email: user?.email };
  if (named.apply) named.apply(u);
  else named = { ...named, user: u };
}

/**
 * Start the toolbar on this page. Idempotent; does nothing during server rendering (no window)
 * or inside an iframe. Never throws.
 */
export function init(opts: InitOptions): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || inIframe()) return;
  const w = window as unknown as Record<symbol, unknown>;
  if (w[BOOTED]) return;
  try {
    Object.defineProperty(window, BOOTED, { value: true });
    start(opts);
  } catch {
    /* never break the page */
  }
}

function start(opts: InitOptions) {
  const server = serverOrigin(opts.server ?? '');
  const key = typeof opts.key === 'string' ? opts.key.trim() : '';
  if (!server || !key) {
    console.info('[open-toolbar] not started: init needs a key and the server URL');
    return;
  }

  // Saved before the hooks wrap fetch, so uploads do not show up in the reviewer's network log.
  const nativeFetch = window.fetch.bind(window);
  const main = startMainWorld();

  const client = createEmbedClient(nativeFetch, server, key);
  const configP: Promise<EmbedConfig> = client.config();
  const reviewer = new ReviewerStore(opts.user ?? named.user ?? {});
  let iso: ReturnType<typeof startIsolatedWorld> | null = null;
  const env = () => (iso ? iso.env() : Promise.reject(new Error('not started')));
  const session = new PageSession({
    client,
    workspaceId: async () => (await configP).workspaceId,
    env,
    reviewer: () => reviewer.get(),
  });
  // Events wait in the isolated world until the config names the preset; the ring, a trace an
  // earlier page of the tab started and its uploads start only then (session.boot), so a key that
  // does not work sends nothing.
  iso = startIsolatedWorld({ transport: session, awaitConfig: true });

  // Locator packets for notes (D-164): the page's part from the isolated world (Svelte dev source
  // through the MAIN-world listener), route files from the app's SvelteKit route table and the last
  // minute's errors mapped through the app's source maps, all read with the saved fetch so they
  // stay out of the network log.
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
  const locate = async (target: LocatorTarget): Promise<LocatorPacket | undefined> => {
    try {
      if (!iso) return undefined;
      const page = await iso.locate(target);
      return await completeLocator(page, { routes, mapper, events: session.recentEvents(60_000) });
    } catch {
      return undefined;
    }
  };

  const assetUrl = (file: string) => `${server}/embed/${file}`;
  let mounted = false;
  let wanted: 'show' | 'hide' | null = new URLSearchParams(location.search).has(SHOW_PARAM) ? 'show' : null;
  const apply = () => {
    if (!mounted || !wanted) return;
    const w = wanted;
    wanted = null;
    void review.ready.then(async () => {
      if (w === 'show') {
        await review.reopen();
        review.wake();
      } else await review.close(false);
    });
  };
  window.openToolbar = {
    show() {
      wanted = 'show';
      apply();
    },
    hide() {
      wanted = 'hide';
      apply();
    },
    setUser,
  };
  named = {
    user: null,
    apply(u) {
      reviewer.setSite(u);
      // the composer's name field follows, once the toolbar has read it (review.ready)
      if (mounted)
        void review.ready.then(async () => {
          const who = await reviewer.load();
          review.reviewerName = who.name;
          review.askName = who.ask;
        });
    },
  };

  const mountUi = (cfg: EmbedConfig) => {
    setPlatform(
      createPagePlatform({
        client,
        config: cfg,
        session,
        locate,
        shoot: createShooter(nativeFetch),
        reviewer,
        env,
        assetUrl,
      }),
    );
    const host = document.createElement(UI_HOST_TAG);
    const shadow = host.attachShadow({ mode: 'open' });
    adoptStyles(shadow, HOST_CSS + '\n' + tokens);
    const target = document.createElement('div');
    shadow.appendChild(target);
    // Keys typed into the toolbar stay out of the page's shortcuts.
    for (const t of ['keydown', 'keyup', 'keypress'] as const) target.addEventListener(t, (e) => e.stopPropagation());
    document.documentElement.appendChild(host);
    // the bundled faces (D-175), served by the server next to embed.js; @font-face does not apply
    // inside a shadow root, so they go on the page's document under their tb-* names
    registerFonts(document, assetUrl);
    mount(App, { target, props: { accent: cfg.brand?.accent ?? null, brand: cfg.brand?.name ?? 'open-toolbar' } });
    mounted = true;
    // a show or hide asked before the mount waits for the toolbar's stored state (review.ready)
    apply();
  };

  configP.then(
    (cfg) => {
      // the project's preset and body policy (D-123, D-125): events held until now are released
      session.command({ type: 'config', maskingPreset: cfg.maskingPreset, bodyPolicy: { preset: cfg.maskingPreset, origins: [location.origin], allowlist: [...(cfg.bodyAllowlist ?? [])] } });
      session.boot();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountUi(cfg), { once: true });
      else mountUi(cfg);
    },
    (e: unknown) => {
      // no UI and no capture: the key is unknown, turned off, or not for this origin. The session
      // never booted (no ring, no trace, no timer); a trace stored in the tab stays for a later page.
      main.stop();
      const why = e instanceof EmbedHttpError ? (e.status === 403 ? 'this origin is not one of the project' : e.status === 404 ? 'the key is unknown or turned off' : `the server answered ${e.code}`) : 'the server did not answer';
      console.info(`[open-toolbar] not started: ${why}`);
    },
  );
}
