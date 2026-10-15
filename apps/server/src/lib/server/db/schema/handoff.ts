// Agent hand-off (PLAN "Hand-off to the agent"): whether a piece of feedback is resolved. One row
// per resolved capture; reopening deletes the row. Owner: the hand-off work package.
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { ts } from './columns.ts';
import { user } from './auth.ts';
import { recording } from './captures.ts';

export const feedbackResolution = pgTable('feedback_resolution', {
  recordingId: uuid('recording_id')
    .primaryKey()
    .references(() => recording.id, { onDelete: 'cascade' }),
  resolvedAt: ts('resolved_at').notNull().defaultNow(),
  resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
  /** snapshot of the resolver's name and email at the time */
  resolvedByName: text('resolved_by_name'),
  resolvedByEmail: text('resolved_by_email'),
  /** the cause and the fix, in the resolver's words */
  note: text('note'),
  /** commit or PR that fixed it */
  commit: text('commit'),
  /** the MCP client's name, "API" or "browser" */
  via: text('via'),
});
