// Projects (Part 2 "Zero integration" and "Privacy", D-117): the origins the extension may run
// on in a workspace and the masking preset it applies there. Architecture section 6 names the table.
import { sql } from 'drizzle-orm';
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('project_org_idx').on(t.organizationId)],
);
