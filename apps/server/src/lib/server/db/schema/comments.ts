// Comments on captures. Owner: viewer area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, ts, created } from './columns.ts';
import { user } from './auth.ts';
import { recording } from './captures.ts';

export const comment = pgTable(
  'comment',
  {
    id: id(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    /** Null for anonymous comments on public links (J-134). */
    authorUserId: uuid('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    authorName: text('author_name'),
    body: text('body').notNull(),
    tMs: integer('t_ms'),
    createdAt: created(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('comment_recording_idx').on(t.recordingId, t.createdAt)],
);
