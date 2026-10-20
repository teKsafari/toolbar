// Projects (Part 2 "Zero integration" and "Privacy", D-123): the origins the extension may run
// on in a workspace and the masking preset it applies there. Architecture section 6 names the table.
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, created, updated } from './columns.ts';
import { user, organization } from './auth.ts';

export const project = pgTable(
  'project',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** normalized origins (`@toolbar/shared/projects` normalizeOrigin) */
    origins: text('origins').array().notNull().default(sql`'{}'::text[]`),
    maskingPreset: text('masking_preset', { enum: ['staging', 'production'] }).notNull().default('staging'),
    /** production: URL prefixes whose request and response bodies are kept */
    bodyAllowlist: text('body_allowlist').array().notNull().default(sql`'{}'::text[]`),
    /** traces: span window for open requests in ms (D-166) */
    traceOpenMs: integer('trace_open_ms').notNull().default(10_000),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** D-205: origin -> id of the member who added it from the extension (they may remove it) */
    originAddedBy: jsonb('origin_added_by').$type<Record<string, string>>().notNull().default({}),
    /** D-211: the public embed key (`tbk_...`), in clear like an analytics id; null: embed off */
    embedKey: text('embed_key').unique(),
    embedKeyCreatedAt: timestamp('embed_key_created_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('project_org_idx').on(t.organizationId)],
);
