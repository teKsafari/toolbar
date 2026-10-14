// Folders (J-162 to J-166, J-122, J-237) and recording links (J-015, J-017, J-126, J-167, J-223).
import { z } from 'zod';
import { RECORDING_KINDS } from '../constants.ts';
import { envInfoSchema } from '../schemas.ts';
import { api, defineRoute, emailSchema, idSchema, isoSchema, okSchema, pageOf, pageQuerySchema, personSchema, csvOf } from './common.ts';

// ---------- folders ----------

export const folderSchema = z.object({
  id: idSchema,
  /** 4-character id used in folder URLs (/f/<shortId>, J-162) */
  shortId: z.string().regex(/^[a-z0-9]{4,8}$/),
  workspaceId: idSchema,
  name: z.string(),
  parentId: idSchema.nullable(),
  /** hidden from members without access (J-237) */
  private: z.boolean(),
  captureCount: z.number().int().nonnegative(),
  createdBy: personSchema.nullable(),
  createdAt: isoSchema,
});
export type Folder = z.infer<typeof folderSchema>;

const workspaceParams = z.object({ workspaceId: idSchema });
/** A folder uuid or its shortId */
const folderParams = z.object({ id: z.string().min(4).max(36) });

export const listFolders = defineRoute({
  name: 'folders.list',
  method: 'GET',
  path: api('/workspaces/:workspaceId/folders'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  params: workspaceParams,
  response: z.object({ items: z.array(folderSchema) }),
  area: 'dashboard',
  tasks: ['J-162', 'J-081', 'J-150'],
  summary: 'Folders of a workspace, alphabetical, with capture counts.',
});

export const createFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: idSchema.optional(),
  private: z.boolean().default(false),
});

export const createFolder = defineRoute({
  name: 'folders.create',
  method: 'POST',
  path: api('/workspaces/:workspaceId/folders'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: workspaceParams,
  body: createFolderBodySchema,
  response: folderSchema,
  area: 'dashboard',
  tasks: ['J-163', 'J-151'],
  summary: 'Create a folder.',
});

export const getFolder = defineRoute({
  name: 'folders.get',
  method: 'GET',
  path: api('/folders/:id'),
  auth: 'member',
  scope: 'read',
  params: folderParams,
  response: folderSchema,
  area: 'dashboard',
  tasks: ['J-162', 'J-203'],
  summary: 'One folder by uuid or shortId.',
});

export const updateFolder = defineRoute({
  name: 'folders.update',
  method: 'PATCH',
  path: api('/folders/:id'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: folderParams,
  body: z.object({ name: z.string().trim().min(1).max(200), private: z.boolean(), parentId: idSchema.nullable() }).partial(),
  response: folderSchema,
  area: 'dashboard',
  tasks: ['J-164', 'J-237'],
  summary: 'Rename, move or make a folder private.',
});

export const deleteFolder = defineRoute({
  name: 'folders.delete',
  method: 'DELETE',
  path: api('/folders/:id'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: folderParams,
  response: z.object({ ok: z.literal(true), deletedCaptures: z.number().int().nonnegative() }),
  area: 'dashboard',
  tasks: ['J-164'],
  summary: 'Delete a folder and the captures in it (as Jam does), after the UI confirms.',
});

export const folderShareSchema = z.object({
  url: z.string(),
  /** general access of the folder: workspace members, or only the people listed */
  access: z.enum(['workspace', 'private']),
  people: z.array(z.object({ person: personSchema, role: z.enum(['viewer', 'creator', 'admin']), pending: z.boolean() })),
});

export const getFolderShare = defineRoute({
  name: 'folders.getShare',
  method: 'GET',
  path: api('/folders/:id/share'),
  auth: 'member',
  scope: 'read',
  params: folderParams,
  response: folderShareSchema,
  area: 'dashboard',
  tasks: ['J-122'],
  summary: 'Folder link, who has access, general access.',
});

export const updateFolderShare = defineRoute({
  name: 'folders.updateShare',
  method: 'PATCH',
  path: api('/folders/:id/share'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: folderParams,
  body: z.object({
    access: z.enum(['workspace', 'private']).optional(),
    invite: z.array(z.object({ email: emailSchema, role: z.enum(['viewer', 'creator']) })).max(20).optional(),
    remove: z.array(idSchema).optional(),
  }),
  response: folderShareSchema,
  area: 'dashboard',
  tasks: ['J-122', 'J-237'],
  summary: 'Invite people by email (sends mail), remove people, set general access.',
});

// ---------- recording links ----------

export const linkRefSchema = z.object({
  url: z.string(),
  /** github | gitlab | other, recognised from the URL (J-241) */
  tracker: z.string(),
  /** "org/repo#12" */
  key: z.string().nullable(),
});

export const recordingLinkSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  name: z.string(),
  /** short public URL /rl/<token>; the token is shown again on demand */
  url: z.string(),
  folder: z.object({ id: idSchema, name: z.string() }).nullable(),
  recorderDomain: z.string().nullable(),
  ref: linkRefSchema.nullable(),
  createdBy: personSchema.nullable(),
  createdAt: isoSchema,
  uses: z.number().int().nonnegative(),
  lastUsedAt: isoSchema.nullable(),
  status: z.enum(['active', 'revoked']),
  /** up to four recent capture thumbnails for the mosaic (J-167) */
  thumbs: z.array(z.string()).max(4),
});
export type RecordingLink = z.infer<typeof recordingLinkSchema>;

export const listRecordingLinks = defineRoute({
  name: 'recordingLinks.list',
  method: 'GET',
  path: api('/workspaces/:workspaceId/recording-links'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  params: workspaceParams,
  query: pageQuerySchema.extend({
    status: z.enum(['active', 'revoked', 'all']).default('active'),
    sort: z.enum(['newest', 'oldest', 'most-used', 'name']).default('newest'),
    creators: csvOf(idSchema),
  }),
  response: pageOf(recordingLinkSchema),
  area: 'dashboard',
  tasks: ['J-167', 'J-150'],
  summary: 'Recording links with status, sort and creator filters.',
});

export const createRecordingLinkBodySchema = z.object({
  name: z.string().max(200).default(''),
  folderId: idSchema.nullable().optional(),
  recorderDomain: z.string().max(253).nullable().optional(),
  refUrl: z.string().url().optional(),
});

export const createRecordingLink = defineRoute({
  name: 'recordingLinks.create',
  method: 'POST',
  path: api('/workspaces/:workspaceId/recording-links'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: workspaceParams,
  body: createRecordingLinkBodySchema,
  response: recordingLinkSchema,
  area: 'dashboard',
  tasks: ['J-015', 'J-167'],
  summary: 'Create a recording link (popup row or dashboard popover); the client copies url at once.',
});

export const updateRecordingLink = defineRoute({
  name: 'recordingLinks.update',
  method: 'PATCH',
  path: api('/recording-links/:id'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: z.object({ id: idSchema }),
  body: z
    .object({ name: z.string().max(200), folderId: idSchema.nullable(), refUrl: z.string().url().nullable(), revoked: z.boolean() })
    .partial(),
  response: recordingLinkSchema,
  area: 'dashboard',
  tasks: ['J-223'],
  summary: 'Rename, retarget to a folder, set the ticket URL, or revoke.',
});

export const deleteRecordingLink = defineRoute({
  name: 'recordingLinks.delete',
  method: 'DELETE',
  path: api('/recording-links/:id'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: z.object({ id: idSchema }),
  response: okSchema,
  area: 'dashboard',
  tasks: ['J-167'],
  summary: 'Delete a recording link; captures made through it stay.',
});

/** What the recipient's recorder page needs (J-017). Query presets from J-126 override title/folder/mic. */
export const recorderInfoSchema = z.object({
  name: z.string(),
  workspaceName: z.string(),
  ownerName: z.string().nullable(),
  title: z.string().nullable(),
  mic: z.boolean(),
  ref: linkRefSchema.nullable(),
});

const rlTokenParams = z.object({ token: z.string().min(16).max(64) });

export const getRecorder = defineRoute({
  name: 'recordingLinks.recorder',
  method: 'GET',
  path: api('/rl/:token'),
  auth: 'public',
  params: rlTokenParams,
  query: z.object({ title: z.string().optional(), mic: z.enum(['0', '1']).optional() }),
  response: recorderInfoSchema,
  errors: ['not_found', 'revoked'],
  area: 'dashboard',
  tasks: ['J-017', 'J-126'],
  summary: 'Public info for the recorder page of a recording link.',
});

export const recorderCreateBodySchema = z.object({
  clientId: idSchema,
  kind: z.enum(RECORDING_KINDS).default('link'),
  startedAt: z.number(),
  env: envInfoSchema.optional(),
  note: z.string().max(10_000).optional(),
  /** J-126 presets from the recorder page URL: folder (short id or name in the link's workspace) and a reference */
  folder: z.string().max(200).optional(),
  ref: z.string().max(2000).optional(),
});

export const recorderCreate = defineRoute({
  name: 'recordingLinks.createCapture',
  method: 'POST',
  path: api('/rl/:token/recordings'),
  auth: 'public',
  params: rlTokenParams,
  body: recorderCreateBodySchema,
  response: z.object({ id: idSchema, shareUrl: z.string(), uploadToken: z.string() }),
  errors: ['not_found', 'revoked', 'invalid_body', 'rate_limited'],
  area: 'dashboard',
  tasks: ['J-017'],
  summary:
    'Start a capture through a recording link. The upload token (tb_upl_) authorises chunk, complete, asset and finalize calls for this capture only; finalize emails the link owner.',
});

export const recorderPage = defineRoute({
  name: 'recordingLinks.page',
  method: 'GET',
  path: '/rl/:token',
  auth: 'public',
  params: rlTokenParams,
  query: z.object({ title: z.string().optional(), folder: z.string().optional(), ref: z.string().optional(), mic: z.enum(['0', '1']).optional() }),
  response: 'html',
  area: 'dashboard',
  tasks: ['J-017', 'J-126'],
  summary: 'Recorder page for a link recipient (no extension, no account).',
});

export const folderRoutes = [
  listFolders,
  createFolder,
  getFolder,
  updateFolder,
  deleteFolder,
  getFolderShare,
  updateFolderShare,
  listRecordingLinks,
  createRecordingLink,
  updateRecordingLink,
  deleteRecordingLink,
  getRecorder,
  recorderCreate,
  recorderPage,
] as const;
