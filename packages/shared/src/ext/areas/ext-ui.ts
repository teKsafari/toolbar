// Extension messages the ext-ui area adds. Only the ext-ui area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface ExtUiBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type ExtUiContentCommand = never;
