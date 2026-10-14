// Server plumbing: job queue and notifications. Owner: server-core area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, ts, created } from './columns.ts';
import { user } from './auth.ts';
import { recording } from './captures.ts';

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
