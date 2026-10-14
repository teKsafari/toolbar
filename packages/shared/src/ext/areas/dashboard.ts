// Extension messages the dashboard area adds. Only the dashboard area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface DashboardBgRequests {
  /**
   * J-018: the web app's new-capture button was clicked on the server's own pages. The worker
   * opens the extension popup (the capture menu) over that tab's window.
   */
  'dashboard.newCapture': { req: { from: 'dashboard' }; res: { opened: 'popup' } };
}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type DashboardContentCommand = never;
