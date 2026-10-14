// Issue trackers, chat webhooks and outgoing webhooks per workspace. Owner: dashboard area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, id, ts, created } from './columns.ts';
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

// ---------- dashboard area additions ----------

/** Issues filed from a capture, or referenced in its text (J-241). */
export const linkedIssue = pgTable(
  'linked_issue',
  {
    id: id(),
    recordingId: uuid('recording_id').notNull(),
    integrationId: uuid('integration_id').references(() => integration.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    url: text('url').notNull(),
    key: text('key').notNull(),
    title: text('title'),
    createdAt: created(),
  },
  (t) => [index('linked_issue_recording_idx').on(t.recordingId), uniqueIndex('linked_issue_uq').on(t.recordingId, t.url)],
);

/** One delivery of one event to one webhook endpoint, with its retry state (J-142). */
export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: id(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'ok', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    error: text('error'),
    createdAt: created(),
    nextAttemptAt: ts('next_attempt_at'),
    lastAttemptAt: ts('last_attempt_at'),
  },
  (t) => [index('webhook_delivery_hook_idx').on(t.webhookId, t.createdAt)],
);
