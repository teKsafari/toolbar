// Share settings and share tokens (architecture s8, D-012). Page routes /s/:token live here too.
import { z } from 'zod';
import { SHARE_ACCESS } from '../constants.ts';
import { api, defineRoute, idSchema, isoSchema, okSchema, personSchema } from './common.ts';

export const shareLinkSchema = z.object({
  id: idSchema,
  /** full URL with the token; the server keeps an encrypted copy so it can show it again */
  url: z.string(),
  access: z.enum(SHARE_ACCESS),
  /** false: content-only link with media, title, description and comments, no dev tools (J-118) */
  devtools: z.boolean(),
  createdAt: isoSchema,
  createdBy: personSchema.nullable(),
  expiresAt: isoSchema.nullable(),
  revokedAt: isoSchema.nullable(),
  lastUsedAt: isoSchema.nullable(),
});
export type ShareLink = z.infer<typeof shareLinkSchema>;

export const shareSettingsSchema = z.object({
  /** General access of the capture (J-119); applies to every link */
  access: z.enum(SHARE_ACCESS),
  /** the default link (devtools) and the content-only link, created on first read */
  link: shareLinkSchema,
  contentOnlyLink: shareLinkSchema,
  links: z.array(shareLinkSchema),
});
export type ShareSettings = z.infer<typeof shareSettingsSchema>;

const recordingIdParams = z.object({ id: idSchema });

export const getShare = defineRoute({
  name: 'sharing.get',
  method: 'GET',
  path: api('/recordings/:id/share'),
  auth: 'member',
  scope: 'read',
  params: recordingIdParams,
  response: shareSettingsSchema,
  area: 'server-core',
  tasks: ['X-03', 'J-117', 'J-118', 'J-119'],
  summary: 'Share settings and links of a capture.',
});

export const updateShare = defineRoute({
  name: 'sharing.update',
  method: 'PATCH',
  path: api('/recordings/:id/share'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: recordingIdParams,
  body: z.object({ access: z.enum(SHARE_ACCESS) }),
  response: shareSettingsSchema,
  area: 'server-core',
  tasks: ['J-119'],
  summary: 'Set general access: anyone with the link, or workspace members only.',
});

export const createShareLinkBodySchema = z.object({
  access: z.enum(SHARE_ACCESS).optional(),
  devtools: z.boolean().default(true),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export const createShareLink = defineRoute({
  name: 'sharing.createLink',
  method: 'POST',
  path: api('/recordings/:id/share-links'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: recordingIdParams,
  body: createShareLinkBodySchema,
  response: shareLinkSchema,
  area: 'server-core',
  tasks: ['X-03'],
  summary: 'Mint another share token (128-bit, base64url).',
});

export const revokeShareLink = defineRoute({
  name: 'sharing.revokeLink',
  method: 'DELETE',
  path: api('/share-links/:id'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: z.object({ id: idSchema }),
  response: okSchema,
  area: 'server-core',
  tasks: ['X-03'],
  summary: 'Revoke a share token; the page then returns 404.',
});

export const shareResolutionSchema = z.object({
  recordingId: idSchema,
  access: z.enum(SHARE_ACCESS),
  devtools: z.boolean(),
  expiresAt: isoSchema.nullable(),
});

export const resolveShare = defineRoute({
  name: 'sharing.resolve',
  method: 'GET',
  path: api('/share/:token'),
  auth: 'public',
  params: z.object({ token: z.string().min(16).max(64) }),
  response: shareResolutionSchema,
  errors: ['not_found', 'unauthorized'],
  area: 'server-core',
  tasks: ['X-03', 'J-121'],
  summary: 'Resolve a share token to its capture. Unknown, revoked and expired tokens all return 404; workspace-only links return 401 when signed out.',
});

// ---------- page routes (not JSON) ----------

const tokenParams = z.object({ token: z.string().min(16).max(64) });

export const sharePage = defineRoute({
  name: 'sharing.page',
  method: 'GET',
  path: '/s/:token',
  auth: 'public',
  params: tokenParams,
  query: z.object({ t: z.coerce.number().nonnegative().optional(), comment: idSchema.optional() }),
  response: 'html',
  area: 'viewer',
  tasks: ['J-090', 'J-097', 'J-121', 'J-129', 'J-153'],
  summary:
    'Share viewer. ?t= seeks (seconds, J-097), ?comment= highlights (J-129). Headers: no-referrer, noindex, Link to the markdown alternate. Accept: text/markdown gets the markdown summary.',
});

export const shareMarkdown = defineRoute({
  name: 'sharing.markdown',
  method: 'GET',
  path: '/s/:token.md',
  auth: 'public',
  params: tokenParams,
  response: 'markdown',
  area: 'agent',
  tasks: ['J-153'],
  summary: 'Markdown summary for plain fetches: front matter, signal counts, comments, pointers to MCP and CLI.',
});

export const shareMedia = defineRoute({
  name: 'sharing.media',
  method: 'GET',
  path: '/s/:token/media/:name',
  auth: 'public',
  params: z.object({ token: z.string().min(16).max(64), name: z.string().regex(/^[a-z0-9-]+$/) }),
  response: 'binary',
  area: 'server-core',
  tasks: ['X-03'],
  summary: 'Range-capable media proxy for share-link viewers (same names as captures.media).',
});

export const sharingRoutes = [getShare, updateShare, createShareLink, revokeShareLink, resolveShare, sharePage, shareMarkdown, shareMedia] as const;
