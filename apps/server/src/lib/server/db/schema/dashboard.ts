// Folders and recording links. Owner: dashboard area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, id, ts, created } from './columns.ts';
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
  },
  (t) => [index('folder_org_idx').on(t.organizationId)],
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
  },
  (t) => [index('recording_link_org_idx').on(t.organizationId)],
);
