// Extension messages the auth area adds. Only the auth area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface AuthBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type AuthContentCommand = never;
