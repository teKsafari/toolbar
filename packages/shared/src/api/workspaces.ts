// Workspaces, members, roles, invites, audit log, search.
import { z } from 'zod';
import { RECORDING_KINDS, SHARE_ACCESS } from '../constants.ts';
import { api, boolQuery, csvOf, defineRoute, emailSchema, idSchema, isoSchema, okSchema, pageOf, pageQuerySchema, personSchema, SEAT_ROLES, type SeatRole } from './common.ts';
import { CAPTURE_SOURCES, captureSummarySchema } from './captures.ts';
import { folderSchema } from './folders.ts';

/**
 * Better Auth stores organization roles as text. The workspace owner is stored as "owner" and
 * acts as admin; Better Auth's default "member" acts as creator.
 */
export const DB_MEMBER_ROLES = ['owner', 'admin', 'creator', 'viewer', 'member'] as const;
export function seatRoleOf(dbRole: string): SeatRole {
  if (dbRole === 'owner' || dbRole === 'admin') return 'admin';
  if (dbRole === 'viewer') return 'viewer';
  return 'creator';
}
export function roleAtLeast(have: SeatRole, need: SeatRole): boolean {
  return SEAT_ROLES.indexOf(have) >= SEAT_ROLES.indexOf(need);
}

export const workspaceSettingsSchema = z.object({
  name: z.string().min(1).max(100),
  logoUrl: z.string().nullable(),
  /** default general access for new captures (J-120) */
  defaultLinkAccess: z.enum(SHARE_ACCESS),
  /** people who sign up with this email domain join as viewers (J-125) */
  domainJoin: z.object({ enabled: z.boolean(), domain: z.string().nullable() }),
  /** AI title, chapters and analysis for everyone (J-156) */
  aiEnabled: z.boolean(),
  /** delete captures older than N days (J-178); null keeps them */
  autoDeleteDays: z.number().int().positive().nullable(),
  inviteLinkEnabled: z.boolean(),
  /** only admins may invite (J-173) */
  restrictInvites: z.boolean(),
  /** a viewer who creates a capture becomes creator (J-222) */
  autoApproveCreators: z.boolean(),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  /** the caller's seat */
  role: z.enum(SEAT_ROLES),
  isOwner: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  createdAt: isoSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceDetailSchema = workspaceSchema.extend({ settings: workspaceSettingsSchema });

const workspaceParams = z.object({ workspaceId: idSchema });

export const listWorkspaces = defineRoute({
  name: 'workspaces.list',
  method: 'GET',
  path: api('/workspaces'),
  auth: 'member',
  scope: 'read',
  response: z.object({ items: z.array(workspaceSchema), activeId: idSchema.nullable() }),
  area: 'auth',
  tasks: ['J-168', 'J-080'],
  summary: "The caller's workspaces and the active one.",
});

export const createWorkspace = defineRoute({
  name: 'workspaces.create',
  method: 'POST',
  path: api('/workspaces'),
  auth: 'member',
  scope: 'write',
  body: z.object({ name: z.string().trim().min(1).max(100), domainJoin: z.boolean().default(true) }),
  response: workspaceSchema,
  area: 'auth',
  tasks: ['J-221'],
  summary: 'Create a workspace with the caller as owner and switch to it.',
});

export const getWorkspace = defineRoute({
  name: 'workspaces.get',
  method: 'GET',
  path: api('/workspaces/:workspaceId'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  params: workspaceParams,
  response: workspaceDetailSchema,
  area: 'dashboard',
  tasks: ['J-172'],
  summary: 'Workspace with its settings.',
});

export const updateWorkspace = defineRoute({
  name: 'workspaces.update',
  method: 'PATCH',
  path: api('/workspaces/:workspaceId'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: workspaceParams,
  body: workspaceSettingsSchema.omit({ logoUrl: true }).extend({ logoAssetId: idSchema.nullable() }).partial(),
  response: workspaceDetailSchema,
  area: 'dashboard',
  tasks: ['J-120', 'J-125', 'J-156', 'J-172', 'J-173', 'J-178', 'J-222'],
  summary: 'Change workspace settings (admins). Saves at once, no plan gates.',
});

export const deleteWorkspace = defineRoute({
  name: 'workspaces.delete',
  method: 'DELETE',
  path: api('/workspaces/:workspaceId'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: workspaceParams,
  response: okSchema,
  area: 'dashboard',
  tasks: ['J-249'],
  summary: 'Delete a workspace, its captures and its media (purge job).',
});

// ---------- members ----------

export const memberSchema = z.object({
  userId: idSchema,
  person: personSchema,
  role: z.enum(SEAT_ROLES),
  isOwner: z.boolean(),
  joinedAt: isoSchema,
  lastActiveAt: isoSchema.nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const listMembers = defineRoute({
  name: 'members.list',
  method: 'GET',
  path: api('/workspaces/:workspaceId/members'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  params: workspaceParams,
  query: z.object({ q: z.string().optional() }),
  response: z.object({ items: z.array(memberSchema) }),
  area: 'dashboard',
  tasks: ['J-173', 'J-135', 'J-150', 'J-228'],
  summary: 'Members with role and last activity (also the @mention picker source).',
});

const memberParams = z.object({ workspaceId: idSchema, userId: idSchema });

export const updateMember = defineRoute({
  name: 'members.update',
  method: 'PATCH',
  path: api('/workspaces/:workspaceId/members/:userId'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: memberParams,
  body: z.object({ role: z.enum(SEAT_ROLES) }),
  response: memberSchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'last_admin'],
  area: 'dashboard',
  tasks: ['J-222', 'J-124'],
  summary: "Change a member's seat: viewer, creator or admin.",
});

export const removeMember = defineRoute({
  name: 'members.remove',
  method: 'DELETE',
  path: api('/workspaces/:workspaceId/members/:userId'),
  auth: 'member',
  scope: 'write',
  params: memberParams,
  response: okSchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'last_admin'],
  area: 'dashboard',
  tasks: ['J-173', 'J-249'],
  summary: 'Remove a member (admins) or leave (yourself). Their captures stay in the workspace.',
});

// ---------- invites ----------

export const INVITE_ROLES = ['creator', 'viewer'] as const;

export const inviteSchema = z.object({
  id: idSchema,
  email: z.string(),
  role: z.enum(INVITE_ROLES),
  status: z.enum(['pending', 'accepted', 'canceled', 'expired']),
  invitedBy: personSchema.nullable(),
  createdAt: isoSchema,
  expiresAt: isoSchema,
});

export const listInvites = defineRoute({
  name: 'invites.list',
  method: 'GET',
  path: api('/workspaces/:workspaceId/invites'),
  auth: 'member',
  role: 'creator',
  scope: 'read',
  params: workspaceParams,
  response: z.object({ items: z.array(inviteSchema) }),
  area: 'auth',
  tasks: ['J-123'],
  summary: 'Pending invitations.',
});

export const createInvites = defineRoute({
  name: 'invites.create',
  method: 'POST',
  path: api('/workspaces/:workspaceId/invites'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: workspaceParams,
  body: z.object({ emails: z.array(emailSchema).min(1).max(20), role: z.enum(INVITE_ROLES).default('creator') }),
  response: z.object({ items: z.array(inviteSchema) }),
  area: 'auth',
  tasks: ['J-123'],
  summary: 'Invite by email (Mailpit in dev). Forbidden for non-admins when invites are restricted.',
});

export const cancelInvite = defineRoute({
  name: 'invites.cancel',
  method: 'DELETE',
  path: api('/invites/:id'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: z.object({ id: idSchema }),
  response: okSchema,
  area: 'auth',
  tasks: ['J-123'],
  summary: 'Cancel a pending invitation.',
});

export const inviteLinkSchema = z.object({
  enabled: z.boolean(),
  url: z.string().nullable(),
  /** people joining by link come in as creators (J-234) */
  role: z.literal('creator'),
  expiresAt: isoSchema.nullable(),
});

export const getInviteLink = defineRoute({
  name: 'invites.getLink',
  method: 'GET',
  path: api('/workspaces/:workspaceId/invite-link'),
  auth: 'member',
  role: 'creator',
  scope: 'read',
  params: workspaceParams,
  response: inviteLinkSchema,
  area: 'auth',
  tasks: ['J-173', 'J-234'],
  summary: 'Workspace invite link (29-day expiry).',
});

export const resetInviteLink = defineRoute({
  name: 'invites.resetLink',
  method: 'POST',
  path: api('/workspaces/:workspaceId/invite-link/reset'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: workspaceParams,
  response: inviteLinkSchema,
  status: 200,
  area: 'auth',
  tasks: ['J-173'],
  summary: 'Replace the invite link; the old one stops working.',
});

export const invitePreviewSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string().nullable(),
  role: z.enum(INVITE_ROLES),
  email: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'canceled', 'expired']),
});

export const previewInvite = defineRoute({
  name: 'invites.preview',
  method: 'GET',
  path: api('/invites/:id'),
  auth: 'public',
  params: z.object({ id: z.string().min(8) }),
  response: invitePreviewSchema,
  errors: ['not_found'],
  area: 'auth',
  tasks: ['J-123', 'J-234'],
  summary: 'What an invitation or invite-link token leads to, for the join page (/invite/:id).',
});

export const acceptInvite = defineRoute({
  name: 'invites.accept',
  method: 'POST',
  path: api('/invites/:id/accept'),
  auth: 'session',
  params: z.object({ id: z.string().min(8) }),
  response: z.object({ workspaceId: idSchema, role: z.enum(SEAT_ROLES) }),
  status: 200,
  errors: ['unauthorized', 'not_found', 'expired'],
  area: 'auth',
  tasks: ['J-123', 'J-234'],
  summary: 'Join a workspace from an email invitation id or an invite-link token.',
});

// ---------- audit log ----------

export const AUDIT_ACTIONS = [
  'capture.created',
  'capture.deleted',
  'capture.shared',
  'member.joined',
  'member.removed',
  'member.role_changed',
  'workspace.updated',
  'integration.connected',
  'integration.removed',
  'token.created',
  'token.revoked',
] as const;

export const auditEntrySchema = z.object({
  id: idSchema,
  at: isoSchema,
  actor: personSchema.nullable(),
  action: z.enum(AUDIT_ACTIONS),
  target: z.object({ type: z.string(), id: z.string(), label: z.string().nullable() }).nullable(),
  details: z.record(z.string(), z.unknown()),
});

export const listAudit = defineRoute({
  name: 'workspaces.audit',
  method: 'GET',
  path: api('/workspaces/:workspaceId/audit'),
  auth: 'member',
  role: 'admin',
  scope: 'read',
  params: workspaceParams,
  query: pageQuerySchema.extend({ actions: csvOf(z.enum(AUDIT_ACTIONS)) }),
  response: pageOf(auditEntrySchema),
  area: 'dashboard',
  tasks: ['J-178'],
  summary: 'Audit log: creates, deletes, shares and role changes.',
});

// ---------- search ----------

export const searchQuerySchema = z.object({
  q: z.string().max(500).default(''),
  workspaceId: idSchema.optional(),
  kinds: csvOf(z.enum(RECORDING_KINDS)),
  sources: csvOf(z.enum(CAPTURE_SOURCES)),
  authors: csvOf(idSchema),
  folderId: idSchema.optional(),
  hasIssue: boolQuery,
  from: isoSchema.optional(),
  to: isoSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const SEARCH_FIELDS = ['title', 'description', 'comment', 'transcript', 'url', 'issue', 'author', 'id'] as const;

export const searchResultSchema = z.object({
  members: z.array(z.object({ userId: idSchema, person: personSchema, role: z.enum(SEAT_ROLES) })),
  folders: z.array(folderSchema),
  captures: z.array(
    captureSummarySchema.extend({ match: z.object({ field: z.enum(SEARCH_FIELDS), snippet: z.string() }).nullable() }),
  ),
  total: z.number().int().nonnegative(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const search = defineRoute({
  name: 'search.query',
  method: 'GET',
  path: api('/search'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  query: searchQuerySchema,
  response: searchResultSchema,
  errors: ['unauthorized', 'forbidden', 'invalid_query'],
  area: 'dashboard',
  tasks: ['J-161', 'J-228', 'J-150', 'J-241'],
  summary: 'Palette and MCP search: titles, descriptions, comments, transcripts, linked issues, author; a pasted URL or id matches that capture.',
});

export const recentCaptures = defineRoute({
  name: 'search.recent',
  method: 'GET',
  path: api('/search/recent'),
  auth: 'member',
  scope: 'read',
  query: z.object({ workspaceId: idSchema.optional(), limit: z.coerce.number().int().min(1).max(20).default(8) }),
  response: z.object({ items: z.array(captureSummarySchema) }),
  area: 'dashboard',
  tasks: ['J-161'],
  summary: 'Recently viewed captures for the empty palette.',
});

export const workspaceRoutes = [
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  listMembers,
  updateMember,
  removeMember,
  listInvites,
  createInvites,
  cancelInvite,
  getInviteLink,
  resetInviteLink,
  previewInvite,
  acceptInvite,
  listAudit,
  search,
  recentCaptures,
] as const;
