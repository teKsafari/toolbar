// Issue trackers, chat webhooks and outgoing webhooks per workspace. Owner: dashboard area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, id, created } from './columns.ts';
import { user, organization } from './auth.ts';

export const integration = pgTable(
  'integration',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [index('integration_org_idx').on(t.organizationId)],
);

export const webhook = pgTable(
  'webhook',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** HMAC signing secret, AES-GCM encrypted. */
    secretEnc: bytea('secret_enc').notNull(),
    events: text('events').array().notNull().default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [index('webhook_org_idx').on(t.organizationId)],
);
