// The signed-in user: profile, settings, active workspace, API tokens, extension sign-in, MCP clients, health.
import { z } from 'zod';
import { extTokenExchangeSchema, healthSchema } from '../schemas.ts';
import { LIMITS } from '../constants.ts';
import { api, defineRoute, idSchema, isoSchema, okSchema, personSchema } from './common.ts';
import { workspaceSchema } from './workspaces.ts';
import { folderSchema } from './folders.ts';
import { integrationSchema } from './integrations.ts';

// ---------- me ----------

export const meSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  /** how this request authenticated */
  via: z.enum(['session', 'device', 'personal', 'upload']),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  /** profile role picker hint (J-175) */
  roleHint: z.string().nullable().optional(),
  activeWorkspaceId: idSchema.nullable().optional(),
});
export type Me = z.infer<typeof meSchema>;

export const getMe = defineRoute({
  name: 'account.me',
  method: 'GET',
  path: api('/me'),
  auth: 'member',
  scope: 'read',
  response: meSchema,
  area: 'auth',
  tasks: ['X-05', 'X-06'],
  summary: 'The caller.',
});

export const updateMe = defineRoute({
  name: 'account.update',
  method: 'PATCH',
  path: api('/me'),
  auth: 'member',
  scope: 'write',
  body: z
    .object({
      firstName: z.string().max(100),
      lastName: z.string().max(100),
      roleHint: z.string().max(100).nullable(),
      imageAssetId: idSchema.nullable(),
    })
    .partial(),
  response: meSchema,
  area: 'dashboard',
  tasks: ['J-175'],
  summary: 'Profile: name, avatar, role hint. Email is locked.',
});

export const deleteMe = defineRoute({
  name: 'account.delete',
  method: 'DELETE',
  path: api('/me'),
  auth: 'session',
  body: z.object({ confirm: z.literal('DELETE') }),
  response: z.object({ ok: z.literal(true), deletedWorkspaces: z.array(idSchema) }),
  errors: ['unauthorized', 'invalid_body', 'last_admin'],
  area: 'dashboard',
  tasks: ['J-225', 'J-249'],
  summary: 'Delete the account. Solo workspaces are erased; refused while sole admin of a shared workspace.',
});

export const setActiveWorkspace = defineRoute({
  name: 'account.setActiveWorkspace',
  method: 'PUT',
  path: api('/me/active-workspace'),
  auth: 'member',
  body: z.object({ workspaceId: idSchema }),
  response: okSchema,
  area: 'auth',
  tasks: ['J-168'],
  summary: 'Switch the active workspace.',
});

// ---------- settings ----------

export const notificationSettingsSchema = z.object({
  firstView: z.boolean(),
  sharedWithMe: z.boolean(),
  recordingLinkUsed: z.boolean(),
  domainSignup: z.boolean(),
  mentions: z.boolean(),
  /** turn-off-all row (J-136) */
  allOff: z.boolean(),
});

/** Extension settings that follow the account (J-215); the popup also caches them locally. */
export const extensionSettingsSchema = z.object({
  instantReplay: z.boolean(),
  replayMinutes: z.number().int().min(1).max(LIMITS.replayMaxMin),
  replayVideo: z.boolean(),
  replayBlockedSites: z.array(z.string()),
  openInNewTab: z.boolean(),
  captureUserEvents: z.boolean(),
  sendErrorLogs: z.boolean(),
  /** 0, 3 or 6 seconds in the popup (5 and 10 kept valid) (J-005); resets after each shot */
  screenshotDelaySec: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(6), z.literal(10)]),
  recordMode: z.enum(['tab', 'screen', 'desktop']),
  mic: z.boolean(),
  micDeviceId: z.string().nullable(),
});
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

export const editorSettingsSchema = z.object({
  ai: z.boolean(),
  lastWorkspaceId: idSchema.nullable(),
  lastFolderId: idSchema.nullable(),
  lastDestination: z.object({ integrationId: idSchema, fields: z.record(z.string(), z.unknown()) }).nullable(),
  /** remembered tracker values per integration (J-140 recents) */
  recentFields: z.record(z.string(), z.record(z.string(), z.unknown())),
  /** the colour last picked; a fresh draft still starts on the default (J-045) */
  color: z.string().nullable(),
});

export const viewerSettingsSchema = z.object({
  playbackRate: z.number().min(0.25).max(4),
  timeZone: z.enum(['capture', 'local', 'utc']),
  lastTab: z.enum(['info', 'console', 'network', 'actions', 'agent']),
  devtoolsOpen: z.boolean(),
});

export const userSettingsSchema = z.object({
  notifications: notificationSettingsSchema,
  extension: extensionSettingsSchema,
  editor: editorSettingsSchema,
  viewer: viewerSettingsSchema,
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  notifications: { firstView: true, sharedWithMe: true, recordingLinkUsed: true, domainSignup: true, mentions: true, allOff: false },
  extension: {
    instantReplay: false,
    replayMinutes: LIMITS.replayDefaultMin,
    replayVideo: false,
    replayBlockedSites: [],
    openInNewTab: true,
    captureUserEvents: true,
    sendErrorLogs: true,
    screenshotDelaySec: 0,
    recordMode: 'tab',
    mic: false,
    micDeviceId: null,
  },
  editor: { ai: true, lastWorkspaceId: null, lastFolderId: null, lastDestination: null, recentFields: {}, color: null },
  viewer: { playbackRate: 1, timeZone: 'capture', lastTab: 'console', devtoolsOpen: true },
};

/** PATCH body: any subset of each group. */
export const updateUserSettingsSchema = z.object({
  notifications: notificationSettingsSchema.partial().optional(),
  extension: extensionSettingsSchema.partial().optional(),
  editor: editorSettingsSchema.partial().optional(),
  viewer: viewerSettingsSchema.partial().optional(),
});

export const getSettings = defineRoute({
  name: 'account.getSettings',
  method: 'GET',
  path: api('/me/settings'),
  auth: 'member',
  scope: 'read',
  response: userSettingsSchema,
  area: 'dashboard',
  tasks: ['J-136', 'J-176', 'J-215', 'J-081', 'J-092'],
  summary: 'All per-user settings, defaults filled in.',
});

export const updateSettings = defineRoute({
  name: 'account.updateSettings',
  method: 'PATCH',
  path: api('/me/settings'),
  auth: 'member',
  scope: 'write',
  body: updateUserSettingsSchema,
  response: userSettingsSchema,
  area: 'dashboard',
  tasks: ['J-136', 'J-176', 'J-215'],
  summary: 'Merge a partial settings object; toggles save at once.',
});

// ---------- API tokens ----------

export const TOKEN_SCOPES = ['cli:read', 'cli:write', 'mcp:read', 'mcp:write'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const apiTokenSchema = z.object({
  id: idSchema,
  kind: z.enum(['device', 'personal']),
  name: z.string(),
  /** first characters, e.g. "tb_pat_Ab12", for recognition */
  prefix: z.string(),
  scopes: z.array(z.enum(TOKEN_SCOPES)),
  createdAt: isoSchema,
  lastUsedAt: isoSchema.nullable(),
  expiresAt: isoSchema.nullable(),
  revokedAt: isoSchema.nullable(),
});
export type ApiTokenInfo = z.infer<typeof apiTokenSchema>;

export const listTokens = defineRoute({
  name: 'tokens.list',
  method: 'GET',
  path: api('/tokens'),
  auth: 'session',
  query: z.object({ kind: z.enum(['device', 'personal']).optional() }),
  response: z.object({ items: z.array(apiTokenSchema) }),
  area: 'auth',
  tasks: ['J-148', 'X-05'],
  summary: 'Personal tokens and connected browsers (device tokens).',
});

export const createTokenBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.null()]).default(30),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).default(['cli:read']),
});

export const createToken = defineRoute({
  name: 'tokens.create',
  method: 'POST',
  path: api('/tokens'),
  auth: 'session',
  body: createTokenBodySchema,
  response: z.object({ token: apiTokenSchema, /** shown once */ secret: z.string() }),
  area: 'auth',
  tasks: ['J-148'],
  summary: 'Create a personal token (tb_pat_...). A write with a read-only token gets 403.',
});

export const revokeToken = defineRoute({
  name: 'tokens.revoke',
  method: 'DELETE',
  path: api('/tokens/:id'),
  auth: 'session',
  params: z.object({ id: idSchema }),
  response: okSchema,
  area: 'auth',
  tasks: ['J-148', 'X-05'],
  summary: 'Revoke a personal token or disconnect a browser.',
});

// ---------- extension sign-in (architecture s9) ----------

export const extConnectQuerySchema = z.object({
  /** https://<extension id>.chromiumapp.org/cb, id in EXTENSION_IDS */
  redirect_uri: z.string().url(),
  state: z.string().min(8).max(200),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256').default('S256'),
});

export const extConnect = defineRoute({
  name: 'ext.connect',
  method: 'GET',
  path: '/ext/connect',
  auth: 'session',
  query: extConnectQuerySchema,
  response: 'redirect',
  errors: ['invalid_redirect_uri', 'invalid_query'],
  area: 'auth',
  tasks: ['X-05', 'J-217'],
  summary:
    'launchWebAuthFlow target. No session: 302 to /login?next=<this URL>. Session: store a 60 s single-use code bound to the challenge and 302 to redirect_uri?code=...&state=...',
});

export const extTokenBodySchema = extTokenExchangeSchema.extend({
  redirect_uri: z.string().url(),
  /** shown under connected browsers, e.g. "Chromium on Linux" */
  device_name: z.string().max(100).optional(),
});

export const extTokenResponseSchema = z.object({
  token: z.string(),
  tokenId: idSchema,
  user: personSchema,
  workspaces: z.array(workspaceSchema),
  activeWorkspaceId: idSchema.nullable(),
});

export const extToken = defineRoute({
  name: 'ext.token',
  method: 'POST',
  path: api('/ext/token'),
  auth: 'public',
  body: extTokenBodySchema,
  response: extTokenResponseSchema,
  status: 200,
  errors: ['invalid_code', 'expired', 'invalid_body'],
  area: 'auth',
  tasks: ['X-05'],
  summary: 'Exchange code + code_verifier for a device token (tb_dev_...).',
});

export const extLogout = defineRoute({
  name: 'ext.logout',
  method: 'POST',
  path: api('/ext/logout'),
  auth: 'member',
  response: okSchema,
  status: 200,
  area: 'auth',
  tasks: ['X-05'],
  summary: 'Revoke the calling device token.',
});

/** One call the popup and in-page editor make on open; keeps popup paint under budget (J-193). */
export const extBootstrapSchema = z.object({
  user: personSchema,
  workspaces: z.array(workspaceSchema),
  activeWorkspaceId: idSchema.nullable(),
  folders: z.array(folderSchema),
  integrations: z.array(integrationSchema),
  settings: userSettingsSchema,
  limits: z.object({
    chunkBytes: z.number().int(),
    /** MAX_RECORDING_MIN in ms, or null (J-013) */
    maxRecordingMs: z.number().int().nullable(),
    aiAvailable: z.boolean(),
  }),
  serverVersion: z.string(),
  /** paused features the server turned on (docs/scope.md); absent means off. `ai`: FEATURE_AI (D-084) */
  features: z.object({ ai: z.boolean() }).optional(),
  /** recording link to the server admin for the popup menu's report-a-problem item (J-177); env SUPPORT_RECORDING_LINK */
  supportRecordingLink: z.string().nullable().optional(),
});
export type ExtBootstrap = z.infer<typeof extBootstrapSchema>;

export const extBootstrap = defineRoute({
  name: 'ext.bootstrap',
  method: 'GET',
  path: api('/ext/bootstrap'),
  auth: 'member',
  query: z.object({ workspaceId: idSchema.optional() }),
  response: extBootstrapSchema,
  area: 'auth',
  tasks: ['J-001', 'J-080', 'J-081', 'J-215'],
  summary: 'User, workspaces, folders and integrations of the active workspace, settings and limits.',
});

// ---------- MCP clients (agent area) ----------

export const mcpClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: idSchema.nullable(),
  scopes: z.array(z.string()),
  createdAt: isoSchema,
  lastUsedAt: isoSchema.nullable(),
});

export const listMcpClients = defineRoute({
  name: 'agent.listClients',
  method: 'GET',
  path: api('/mcp/clients'),
  auth: 'session',
  response: z.object({ items: z.array(mcpClientSchema), serverUrl: z.string() }),
  area: 'agent',
  tasks: ['J-145', 'J-147'],
  summary: 'Agents connected over MCP OAuth, and the MCP server URL for the setup snippets.',
});

export const removeMcpClient = defineRoute({
  name: 'agent.removeClient',
  method: 'DELETE',
  path: api('/mcp/clients/:id'),
  auth: 'session',
  params: z.object({ id: z.string() }),
  response: okSchema,
  area: 'agent',
  tasks: ['J-147'],
  summary: 'Remove a connected agent; its tokens are revoked at once.',
});

export const mcpEndpoint = defineRoute({
  name: 'agent.mcp',
  method: 'POST',
  path: '/mcp',
  auth: 'public',
  body: 'binary',
  response: 'sse',
  errors: ['unauthorized'],
  area: 'agent',
  tasks: ['J-146', 'J-149', 'J-150', 'J-151'],
  summary: 'Streamable HTTP MCP endpoint. OAuth (DCR + PKCE) or a personal token with mcp:* scopes; 401 carries WWW-Authenticate.',
});

// ---------- health ----------

export const health = defineRoute({
  name: 'core.health',
  method: 'GET',
  path: '/api/health',
  auth: 'public',
  response: healthSchema,
  area: 'server-core',
  tasks: ['X-08'],
  summary: '200 when Postgres and S3 answer, 503 otherwise (D-027).',
});

export const accountRoutes = [
  getMe,
  updateMe,
  deleteMe,
  setActiveWorkspace,
  getSettings,
  updateSettings,
  listTokens,
  createToken,
  revokeToken,
  extConnect,
  extToken,
  extLogout,
  extBootstrap,
  listMcpClients,
  removeMcpClient,
  mcpEndpoint,
  health,
] as const;
