// Extension messages the capture area adds. Only the capture area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface CaptureBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type CaptureContentCommand = never;
