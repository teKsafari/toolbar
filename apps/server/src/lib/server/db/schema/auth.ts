// Better Auth tables (shape from better-auth 1.7.7 getAuthTables with the organization and
// generic-oauth plugins) plus API tokens and the extension sign-in codes. Owner: auth area.
// A workspace is a Better Auth organization.
// Areas append new tables to their own file; edit other files only additively (docs/parallel.md).
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, id, ts, created, updated } from './columns.ts';

export const user = pgTable('user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: created(),
  updatedAt: updated(),
  /** Workspace the dashboard, extension and CLI act in (J-168); session and token alike. Added by auth area. */
  activeWorkspaceId: uuid('active_workspace_id'),
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

export const organization = pgTable('organization', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: created(),
  metadata: text('metadata'),
  /** Workspace settings (api/workspaces.ts workspaceSettingsSchema minus name); defaults fill gaps. Added by auth area. */
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
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
    // Added by auth area (J-148): recognisable prefix, scopes and expiry.
    prefix: text('prefix').notNull().default(''),
    scopes: text('scopes').array().notNull().default(sql`'{cli:read,cli:write,mcp:read,mcp:write}'::text[]`),
    expiresAt: ts('expires_at'),
  },
  (t) => [index('api_token_user_idx').on(t.userId)],
);

export const extAuthCode = pgTable('ext_auth_code', {
  codeHash: bytea('code_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  codeChallenge: text('code_challenge').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

/** Workspace invite link (J-173, J-234): one live token per workspace, 29-day expiry, resettable. */
export const workspaceInviteLink = pgTable('workspace_invite_link', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  tokenHash: bytea('token_hash').notNull().unique(),
  /** sealed with crypto.ts purpose 'invite-link' so the members page can show it again */
  tokenEnc: bytea('token_enc').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: created(),
});
