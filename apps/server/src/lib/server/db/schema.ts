// Drizzle schema: Better Auth tables (shape from better-auth 1.7.7 getAuthTables with the
// organization and generic-oauth plugins) plus the app tables from docs/architecture.md section 6.
// Ids are uuid with a uuidv7() default (Postgres 18). Better Auth passes its own ids, made with
// our uuidv7 (see auth.ts), so every id sorts by creation time.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------- Better Auth

export const user = pgTable('user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: created(),
  updatedAt: updated(),
});

export const session = pgTable(
  'session',
  {
    id: id(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: created(),
    updatedAt: updated(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id'),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

/** providerId + accountId: accountId is the OIDC subject for social and generic OAuth providers. */
export const account = pgTable(
  'account',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('account_user_idx').on(t.userId), uniqueIndex('account_provider_uq').on(t.providerId, t.accountId)],
);

export const verification = pgTable(
  'verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** A workspace is a Better Auth organization. */
export const organization = pgTable('organization', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: created(),
  metadata: text('metadata'),
});

export const member = pgTable(
  'member',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('member_org_user_uq').on(t.organizationId, t.userId), index('member_user_idx').on(t.userId)],
);

export const invitation = pgTable(
  'invitation',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: created(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('invitation_org_idx').on(t.organizationId), index('invitation_email_idx').on(t.email)],
);

// ---------------------------------------------------------------- app

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

/** A capture ("recording" in the API): screenshot, tab video, screen video, instant replay, link recording. */
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
    createdAt: created(),
    updatedAt: updated(),
    deletedAt: ts('deleted_at'),
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
    kind: text('kind', { enum: ['screenshot', 'crop', 'annotation', 'keyframe', 'thumb'] }).notNull(),
    s3Key: text('s3_key').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes').notNull(),
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
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [index('share_link_recording_idx').on(t.recordingId)],
);

/** A link someone without the extension opens to record their screen into a workspace (J-015, J-017). */
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

export const apiToken = pgTable(
  'api_token',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['device', 'personal'] }).notNull(),
    name: text('name').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    lastUsedAt: ts('last_used_at'),
    createdAt: created(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('api_token_user_idx').on(t.userId)],
);

/** Single-use code for the extension sign-in hand-off (architecture section 9), 60 s. */
export const extAuthCode = pgTable('ext_auth_code', {
  codeHash: bytea('code_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  codeChallenge: text('code_challenge').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

/** Issue trackers and chat apps per workspace. Secrets inside config are encrypted at rest. */
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

/** Postgres job queue, polled with SELECT ... FOR UPDATE SKIP LOCKED (D-010). */
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
