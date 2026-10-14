// Agent area tables: MCP OAuth clients (dynamic client registration), grants (one per connected
// agent, user and workspace), authorization codes and access or refresh tokens (J-146, J-147).
// Only sha256 hashes of codes, secrets and tokens are stored. Owner: agent area.
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, id, ts, created } from './columns.ts';
import { organization, user } from './auth.ts';

export const mcpClient = pgTable('mcp_client', {
  /** public client id, "nbc_" + random */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  clientUri: text('client_uri'),
  logoUri: text('logo_uri'),
  /** "none" for public clients (PKCE only); else client_secret_post or client_secret_basic */
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  secretHash: bytea('secret_hash'),
  createdAt: created(),
});

/** One connected agent: a client authorised by a user for one workspace. Removing it revokes its tokens. */
export const mcpGrant = pgTable(
  'mcp_grant',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => mcpClient.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdAt: created(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('mcp_grant_user_idx').on(t.userId)],
);

export const mcpAuthCode = pgTable('mcp_auth_code', {
  codeHash: bytea('code_hash').primaryKey(),
  grantId: uuid('grant_id')
    .notNull()
    .references(() => mcpGrant.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const mcpToken = pgTable(
  'mcp_token',
  {
    id: id(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => mcpGrant.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['access', 'refresh'] }).notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: created(),
  },
  (t) => [index('mcp_token_grant_idx').on(t.grantId)],
);
