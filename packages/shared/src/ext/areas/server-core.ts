// Extension messages the server-core area adds. Only the server-core area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface ServerCoreBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type ServerCoreContentCommand = never;
