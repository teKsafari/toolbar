// Dependency-free constants the dashboard shares with the extension's content script (J-018).
// Kept apart from ./dashboard.ts so the content script does not pull in zod.
// Only the dashboard area edits this file.

/**
 * J-018: the dashboard's new-capture button dispatches this DOM event on `window`
 * (`new CustomEvent(NEW_CAPTURE_EVENT, { detail: { from: 'dashboard' } })`). The extension's
 * isolated content script (`entrypoints/toolbar-web.content.ts`) listens for it and asks the
 * worker to open the capture menu. The same script marks the document with
 * `data-tb-extension` on <html>; without the mark the dashboard shows install help instead.
 */
export const NEW_CAPTURE_EVENT = 'tb:new-capture';
export const EXTENSION_MARK_ATTR = 'data-tb-extension';
