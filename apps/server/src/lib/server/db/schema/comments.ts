// Comments on captures, their reactions and attachments, and capture views. Owner: viewer area.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { id, ts, created } from './columns.ts';
import { user } from './auth.ts';
import { asset, recording } from './captures.ts';

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
    /** Thread resolved (J-151); null while open. */
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    /** Opaque per-browser id of an anonymous author, so the same visitor's reactions match. */
    anonKey: text('anon_key'),
  },
  (t) => [index('comment_recording_idx').on(t.recordingId, t.createdAt)],
);

/** One row per (comment, reactor, key). A reactor is `u:<userId>` or `a:<anonKey>` (J-130). */
export const commentReaction = pgTable(
  'comment_reaction',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comment.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull(),
    key: text('key').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.actor, t.key] })],
);

/** Images attached to a comment (J-132); the asset row holds the file. */
export const commentAttachment = pgTable(
  'comment_attachment',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comment.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.assetId] })],
);

/** Who opened a capture and when (recently viewed rows, J-161; first-view email, J-136). */
export const captureView = pgTable(
  'capture_view',
  {
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    /** `u:<userId>` or `a:<anonKey>` */
    viewer: text('viewer').notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    firstAt: created(),
    lastAt: ts('last_at').notNull().defaultNow(),
    count: integer('count').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.viewer] }), index('capture_view_user_idx').on(t.userId, t.lastAt)],
);

