// Folders and recording links. Owner: dashboard area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, id, ts, created, updated } from './columns.ts';
import { user, organization } from './auth.ts';

export const folder = pgTable(
  'folder',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    /** 4-character id for folder URLs (/f/<shortId>, J-162); filled on first read for older rows. */
    shortId: text('short_id'),
  },
  (t) => [index('folder_org_idx').on(t.organizationId), uniqueIndex('folder_short_id_uq').on(t.shortId)],
);

export const recordingLink = pgTable(
  'recording_link',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folder.id, { onDelete: 'set null' }),
    name: text('name').notNull().default(''),
    tokenHash: bytea('token_hash').notNull().unique(),
    tokenEnc: bytea('token_enc').notNull(),
    recorderDomain: text('recorder_domain'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    revokedAt: ts('revoked_at'),
    /** Ticket URL the link was made for (J-241); captures made through it link back to it. */
    refUrl: text('ref_url'),
  },
  (t) => [index('recording_link_org_idx').on(t.organizationId)],
);

// ---------- dashboard area additions ----------

/** Per-user settings (api/account.ts userSettingsSchema); missing keys fall back to defaults. */
export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  /** Profile fields the auth user table does not hold (J-175). */
  firstName: text('first_name'),
  lastName: text('last_name'),
  roleHint: text('role_hint'),
  imageAssetId: uuid('image_asset_id'),
  updatedAt: updated(),
});

/** Workspace audit log (J-178). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    targetLabel: text('target_label'),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    at: created(),
  },
  (t) => [index('audit_log_org_idx').on(t.organizationId, t.at)],
);

/**
 * Which capture lifecycle notices went out (webhooks, recording-link email, audit). The
 * dashboard's notice sweep compares this with recording.finalized_at and deleted_at.
 */
export const captureNotice = pgTable('capture_notice', {
  recordingId: uuid('recording_id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  createdSentAt: ts('created_sent_at'),
  deletedSentAt: ts('deleted_sent_at'),
});
