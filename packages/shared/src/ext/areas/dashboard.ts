// Extension messages the dashboard area adds. Only the dashboard area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface DashboardBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type DashboardContentCommand = never;
