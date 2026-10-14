// Server plumbing: job queue and notifications. Owner: server-core area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, ts, created } from './columns.ts';
import { user } from './auth.ts';
import { recording } from './captures.ts';
import { folder } from './dashboard.ts';

export const notification = pgTable(
  'notification',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    recordingId: uuid('recording_id').references(() => recording.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: created(),
    readAt: ts('read_at'),
  },
  (t) => [index('notification_user_idx').on(t.userId, t.createdAt)],
);

export const job = pgTable(
  'job',
  {
    id: id(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    runAt: ts('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedUntil: ts('locked_until'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    doneAt: ts('done_at'),
    createdAt: created(),
  },
  (t) => [index('job_ready_idx').on(t.runAt).where(sql`done_at IS NULL`)],
);

// ---------- folder privacy (J-237, J-122) ----------
// Kept here so the access check in lib/server/share/access.ts can read it; the dashboard area's
// folder share routes write it. A folder without a row is open to the whole workspace.

export const folderAccess = pgTable('folder_access', {
  folderId: uuid('folder_id')
    .primaryKey()
    .references(() => folder.id, { onDelete: 'cascade' }),
  private: boolean('private').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** People invited to a folder. `userId` is null until an emailed invite is accepted (pending). */
export const folderMember = pgTable(
  'folder_member',
  {
    id: id(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => folder.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    email: text('email'),
    role: text('role', { enum: ['viewer', 'creator', 'admin'] }).notNull().default('viewer'),
    invitedBy: uuid('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [uniqueIndex('folder_member_user_uq').on(t.folderId, t.userId), index('folder_member_email_idx').on(t.email)],
);
