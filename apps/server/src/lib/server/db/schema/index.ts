// Drizzle schema, split per area so parallel work appends to its own file (docs/parallel.md).
// drizzle.config.ts and db/index.ts load this file; the tables are those of drizzle/0000_init.sql.
export * from './auth.ts';
export * from './dashboard.ts';
export * from './captures.ts';
export * from './comments.ts';
export * from './integrations.ts';
export * from './core.ts';
export * from './agent.ts';
