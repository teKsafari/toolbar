// Extension messages the agent area adds. Only the agent area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface AgentBgRequests {}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type AgentContentCommand = never;
