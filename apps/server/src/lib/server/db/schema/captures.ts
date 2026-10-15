// Captures ("recording" in the API), their upload streams, assets, annotations,
// transcripts and share links. Owner: server-core area (capture and editor read and write them).
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, real, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, id, ts, created, updated } from './columns.ts';
import { user, organization } from './auth.ts';
import { folder } from './dashboard.ts';
import { project } from './projects.ts';

export const recording = pgTable(
  'recording',
  {
    id: id(),
    clientId: uuid('client_id').notNull().unique(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folder.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['screenshot', 'video', 'replay', 'screen', 'link'] }).notNull(),
    status: text('status', { enum: ['uploading', 'processing', 'ready', 'failed'] })
      .notNull()
      .default('uploading'),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    pageUrl: text('page_url'),
    pageTitle: text('page_title'),
    startedAt: ts('started_at'),
    durationMs: integer('duration_ms'),
    env: jsonb('env'),
    // Author snapshot at creation (Part 2: issuer, subject, email and name on every record).
    authorUserId: uuid('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    authorIssuer: text('author_issuer'),
    authorSubject: text('author_subject'),
    authorEmail: text('author_email'),
    authorName: text('author_name'),
    recordingLinkId: uuid('recording_link_id'),
    thumbKey: text('thumb_key'),
    // ---- server-core additions (finalize, access, processing) ----
    /** General access of the capture (J-119); share links follow it. */
    access: text('access', { enum: ['anyone', 'workspace'] }).notNull().default('anyone'),
    /** Private capture (J-237): only its author and workspace admins see it. */
    private: boolean('private').notNull().default(false),
    source: text('source', { enum: ['extension', 'recording-link', 'upload', 'cli'] }).notNull().default('extension'),
    /** Kept range in video time, applied by finalize-recording (J-227). */
    trim: jsonb('trim'),
    /** recording start to first video frame (architecture s4 "Clock") */
    videoOffsetMs: integer('video_offset_ms').notNull().default(0),
    videoWidth: integer('video_width'),
    videoHeight: integer('video_height'),
    /** Counts and markers computed at finalize (captureDetailSchema.index). */
    eventIndex: jsonb('event_index'),
    /** [{ label, height, key }] original first (J-054) */
    renditions: jsonb('renditions'),
    chapters: jsonb('chapters'),
    metadata: jsonb('metadata'),
    processingProgress: real('processing_progress'),
    processingError: text('processing_error'),
    finalizedAt: ts('finalized_at'),
    createdAt: created(),
    updatedAt: updated(),
    deletedAt: ts('deleted_at'),
    // ---- Part 2 (D-117, D-119) ----
    /** project whose origin the page was on */
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
    /** masking preset the browser applied: staging, production or none (no project) */
    maskingPreset: text('masking_preset', { enum: ['staging', 'production', 'none'] }),
  },
  (t) => [
    index('recording_org_created_idx').on(t.organizationId, t.createdAt),
    index('recording_folder_idx').on(t.folderId),
    index('recording_author_idx').on(t.authorUserId),
  ],
);

export const recordingStream = pgTable(
  'recording_stream',
  {
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    name: text('name', { enum: ['events', 'rrweb', 'video', 'voice', 'screenshot'] }).notNull(),
    contentType: text('content_type').notNull(),
    lastSeq: integer('last_seq'),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull().default(0),
    completedAt: ts('completed_at'),
    finalKey: text('final_key'),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.name] })],
);

export const recordingChunk = pgTable(
  'recording_chunk',
  {
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    stream: text('stream').notNull(),
    seq: integer('seq').notNull(),
    s3Key: text('s3_key').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    t0: bigint('t0', { mode: 'number' }),
    t1: bigint('t1', { mode: 'number' }),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.stream, t.seq] })],
);

export const asset = pgTable(
  'asset',
  {
    id: id(),
    recordingId: uuid('recording_id').references(() => recording.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['screenshot', 'crop', 'annotation', 'keyframe', 'thumb', 'attachment', 'comment', 'avatar', 'logo'],
    }).notNull(),
    s3Key: text('s3_key').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes').notNull(),
    /** original file name for attachments */
    name: text('name'),
    /** uploader, so an unattached asset can only be claimed by the person who uploaded it */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [index('asset_recording_idx').on(t.recordingId)],
);

export const annotation = pgTable(
  'annotation',
  {
    id: id(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => asset.id, { onDelete: 'set null' }),
    t: bigint('t', { mode: 'number' }),
    shapes: jsonb('shapes').notNull().default(sql`'[]'::jsonb`),
    target: jsonb('target'),
    comment: text('comment'),
    authorUserId: uuid('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [index('annotation_recording_idx').on(t.recordingId)],
);

export const transcript = pgTable(
  'transcript',
  {
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    stream: text('stream').notNull().default('voice'),
    provider: text('provider').notNull(),
    model: text('model'),
    language: text('language'),
    vtt: text('vtt'),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    error: text('error'),
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.stream] })],
);

export const shareLink = pgTable(
  'share_link',
  {
    id: id(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    tokenEnc: bytea('token_enc').notNull(),
    access: text('access', { enum: ['anyone', 'workspace'] })
      .notNull()
      .default('anyone'),
    /** false: content-only link without dev tools (J-118) */
    devtools: boolean('devtools').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [index('share_link_recording_idx').on(t.recordingId)],
);
