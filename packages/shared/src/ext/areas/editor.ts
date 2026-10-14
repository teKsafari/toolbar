// Extension messages the editor area adds. Only the editor area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface EditorBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type EditorContentCommand = never;
