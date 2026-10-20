// Types of @open-toolbar/embed (written by hand; test/types.test.ts keeps them in step with src/).

export interface InitOptions {
  /** the project's embed key, `tbk_...` (Settings, Projects) */
  key: string;
  /** the open-toolbar server, for example `https://toolbar.example.com` */
  server: string;
  /** the signed-in person of the app, when it knows them: the composer then does not ask */
  user?: ReviewerUser;
}

/** The app's signed-in person; a field left out is no longer known. */
export type ReviewerUser = { name?: string; email?: string };

export interface OpenToolbarApi {
  /** show the toolbar again after its X closed it on this site */
  show(): void;
  /** close it on this site, as its X does (a running trace keeps running) */
  hide(): void;
  /** name the reviewer again, as init's `user` does: the app's signed-in person changed */
  setUser(user: ReviewerUser): void;
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

/**
 * Name the reviewer: the app's signed-in person, who changed after init (sign-in, sign-out). The
 * name and email go with the next note or trace; a name the reviewer typed in the composer stays
 * first. Before init it waits for it; during server rendering it does nothing.
 */
export function setUser(user: ReviewerUser): void;
