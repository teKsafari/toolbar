// Extension messages the viewer area adds. Only the viewer area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface ViewerBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type ViewerContentCommand = never;
