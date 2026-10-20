// Types of @open-toolbar/embed (written by hand; test/types.test.ts keeps them in step with src/).

export interface InitOptions {
  /** the project's embed key, `tbk_...` (Settings, Projects) */
  key: string;
  /** the open-toolbar server, for example `https://toolbar.example.com` */
  server: string;
  /** the signed-in person of the app, when it knows them: the composer then does not ask */
  user?: { name?: string; email?: string };
}

export interface OpenToolbarApi {
  /** show the toolbar again after its X closed it on this site */
  show(): void;
  /** close it on this site, as its X does (a running trace keeps running) */
  hide(): void;
}

declare global {
  interface Window {
    openToolbar?: OpenToolbarApi;
  }
}

/**
 * Start the toolbar on this page. Idempotent; does nothing during server rendering (no window)
 * or inside an iframe. Never throws. Call it as early as the app starts: console and network
 * capture begin there.
 */
export function init(opts: InitOptions): void;
