// Feedback items from the in-page reviewer toolbar (Part 2, "What the reviewer can do"): one row
// per pin, drawing, element screenshot or voice note, on a capture (a trace or a `feedback`
// capture). Owner: reviewer-ui work package.
import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, created } from './columns.ts';
import { user } from './auth.ts';
import { asset, recording } from './captures.ts';

export const feedbackItem = pgTable(
  'feedback_item',
  {
    id: id(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    /** the extension's id for the item, so a retried submit is a no-op */
    clientId: uuid('client_id').notNull(),
    /** number on the pin (M-18) */
    n: integer('n').notNull(),
    kind: text('kind', { enum: ['element', 'text', 'draw', 'shot', 'voice', 'note'] }).notNull(),
    comment: text('comment').notNull().default(''),
    quote: text('quote'),
    /** locator packet of the element (TargetRef) */
    target: jsonb('target'),
    /** locator packet from the extension (D-164): route files, Svelte dev source, mapped errors */
    locator: jsonb('locator'),
    anchor: jsonb('anchor'),
    /** drawings in document coordinates */
    shapes: jsonb('shapes').notNull().default(sql`'[]'::jsonb`),
    cropAssetId: uuid('crop_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    cropRect: jsonb('crop_rect'),
    voiceAssetId: uuid('voice_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    voiceDurationMs: integer('voice_duration_ms'),
    transcriptStatus: text('transcript_status', { enum: ['pending', 'running', 'done', 'failed', 'off'] }),
    transcriptVtt: text('transcript_vtt'),
    transcriptText: text('transcript_text'),
    transcriptLanguage: text('transcript_language'),
    transcriptError: text('transcript_error'),
    /** console errors and failed requests of the 60 s before the item */
    context: jsonb('context'),
    page: jsonb('page').notNull(),
    intent: text('intent', { enum: ['fix', 'change', 'question', 'approve'] }).notNull().default('fix'),
    severity: text('severity', { enum: ['blocking', 'important', 'suggestion'] }).notNull().default('important'),
    status: text('status', { enum: ['pending', 'acknowledged', 'resolved', 'dismissed'] }).notNull().default('pending'),
    /** epoch ms when the reviewer added the item */
    t: bigint('t', { mode: 'number' }).notNull(),
    // who left it (Part 2: issuer, subject, email and name on every record)
    authorUserId: uuid('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    authorIssuer: text('author_issuer'),
    authorSubject: text('author_subject'),
    createdAt: created(),
  },
  (t) => [index('feedback_item_recording_idx').on(t.recordingId, t.n), uniqueIndex('feedback_item_client_idx').on(t.recordingId, t.clientId)],
);
