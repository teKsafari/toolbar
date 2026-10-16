// Routes of the agent hand-off (PLAN "Hand-off to the agent"): the feedback folder as a tar.gz,
// its file listing and single files (the MCP tools read the same), resolving feedback, and the
// Agent Skill. routes.ts spreads this list into ROUTE_LIST.
import { z } from 'zod';
import { api, csvOf, defineRoute, idSchema, isoSchema, okSchema } from '../common.ts';
import { RECORDING_KINDS } from '../../constants.ts';

export const folderFileSchema = z.object({ path: z.string(), bytes: z.number().int().nonnegative(), about: z.string(), contentType: z.string() });

export const folderIndexSchema = z.object({
  id: idSchema,
  /** `.feedback/<id>` */
  dir: z.string(),
  pullCommand: z.string(),
  files: z.array(folderFileSchema),
  readme: z.string(),
  /** approximate tokens of README.md (kept under 8000) */
  readmeTokens: z.number().int(),
});
export type FolderIndex = z.infer<typeof folderIndexSchema>;

export const resolutionSchema = z.object({
  resolved: z.boolean(),
  resolvedAt: isoSchema.nullable(),
  resolvedBy: z.object({ id: idSchema.nullable(), name: z.string().nullable(), email: z.string().nullable() }).nullable(),
  note: z.string().nullable(),
  commit: z.string().nullable(),
  /** the MCP client or "API" that resolved it */
  via: z.string().nullable(),
  /** reviewer toolbar pins this call marked resolved (POST only) */
  itemsResolved: z.array(z.number().int()).optional(),
  /** reviewer toolbar pins still pending or acknowledged */
  itemsOpen: z.number().int().nonnegative().default(0),
});
export type Resolution = z.infer<typeof resolutionSchema>;

export const resolveBodySchema = z.object({
  /** one or two sentences: the cause and the fix */
  note: z.string().trim().max(4000).optional(),
  /** commit or PR that fixed it */
  commit: z.string().trim().max(200).optional(),
  /**
   * Pin numbers of reviewer toolbar items this fix closes. Without it every open item is resolved
   * with the capture; with it, the capture counts as resolved once no item is left open.
   */
  items: z.array(z.number().int().positive()).max(500).optional(),
});

const params = z.object({ id: idSchema });

export const getFeedbackFolder = defineRoute({
  name: 'handoff.folder',
  method: 'GET',
  path: api('/recordings/:id/folder'),
  auth: 'member',
  scope: 'read',
  params,
  response: 'binary',
  errors: ['unauthorized', 'forbidden', 'not_found', 'conflict'],
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'The feedback folder as a gzipped tar (`curl ... | tar xz` writes .feedback/<id>/): README.md, feedback.json, spans.jsonl, annotations, keyframes, outline, OCR text, voice, console, network, raw. Members only (personal token, MCP token or session); share links get the summary.',
});

export const getFolderIndex = defineRoute({
  name: 'handoff.folderIndex',
  method: 'GET',
  path: api('/recordings/:id/folder/files'),
  auth: 'member',
  scope: 'read',
  params,
  response: folderIndexSchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'conflict'],
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'Files of the feedback folder with sizes and what each holds, the README text and the pull command.',
});

export const getFolderFile = defineRoute({
  name: 'handoff.folderFile',
  method: 'GET',
  path: api('/recordings/:id/folder/file'),
  auth: 'member',
  scope: 'read',
  params,
  query: z.object({ path: z.string().min(1).max(300) }),
  response: 'binary',
  errors: ['unauthorized', 'forbidden', 'not_found', 'conflict'],
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'One file of the feedback folder by its path inside the folder (README.md, annotations/a01.png, ...).',
});

export const getResolution = defineRoute({
  name: 'handoff.resolution',
  method: 'GET',
  path: api('/recordings/:id/resolve'),
  auth: 'member',
  scope: 'read',
  params,
  response: resolutionSchema,
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'Whether the feedback is resolved, by whom, with which note and commit.',
});

export const resolveFeedback = defineRoute({
  name: 'handoff.resolve',
  method: 'POST',
  path: api('/recordings/:id/resolve'),
  auth: 'member',
  scope: 'write',
  params,
  body: resolveBodySchema,
  response: resolutionSchema,
  status: 200,
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'Mark the feedback resolved, with a note on the cause and fix and the commit, or only some reviewer toolbar pins (items); fires the feedback.resolved webhook once the capture is resolved.',
});

export const reopenFeedback = defineRoute({
  name: 'handoff.reopen',
  method: 'DELETE',
  path: api('/recordings/:id/resolve'),
  auth: 'member',
  scope: 'write',
  params,
  response: okSchema,
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'Open the feedback again.',
});

export const getSkill = defineRoute({
  name: 'handoff.skill',
  method: 'GET',
  path: api('/skill'),
  auth: 'public',
  response: 'markdown',
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'The Agent Skill (SKILL.md) for pulling, reading and resolving feedback, with this server as the default.',
});

// ---------- bulk export (D-182) ----------

/** A date (`2026-10-01`) or a date and time, as the since and until filters take them. */
const dateQuery = z
  .string()
  .trim()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'an ISO date such as 2026-10-01 or 2026-10-01T12:00:00Z');

/** Filters of the bulk export, the feedback list, the index and the MCP list_feedback tool. */
export const feedbackFiltersSchema = z.object({
  /** workspace id; default the caller's active workspace */
  workspace: idSchema.optional(),
  /** project id (Settings, Projects) */
  project: idSchema.optional(),
  /** folder id, or `none` for unfiled captures */
  folder: z.union([idSchema, z.literal('none')]).optional(),
  /** unresolved (default), resolved or all */
  status: z.enum(['unresolved', 'resolved', 'all']).default('unresolved'),
  /** created at or after (inclusive) */
  since: dateQuery.optional(),
  /** created before (exclusive); a bare date means the start of that day, UTC */
  until: dateQuery.optional(),
  /** capture kinds, comma separated */
  kind: csvOf(z.enum(RECORDING_KINDS)),
  /** who made the capture: a user id, an email address, or `me` */
  creator: z.string().trim().min(1).max(320).optional(),
  /** captures in one page (default 50, at most 200); the size cap can end a page earlier */
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** the next-page cursor from the previous answer (header x-next-cursor, or nextCursor) */
  cursor: z.string().max(400).optional(),
});
export type FeedbackFilters = z.infer<typeof feedbackFiltersSchema>;

export const feedbackListItemSchema = z.object({
  id: idSchema,
  url: z.string(),
  createdAt: isoSchema,
  kind: z.enum(RECORDING_KINDS),
  title: z.string(),
  reviewer: z.string().nullable(),
  pageUrl: z.string().nullable(),
  /** host and route pattern of the page (`app.test/lessons/:id`) */
  route: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  /** dead, stuck, silent and error spans; null without events */
  outcomes: z.object({ dead: z.number().int(), stuck: z.number().int(), silent: z.number().int(), error: z.number().int() }).nullable(),
  consoleErrors: z.number().int(),
  failedRequests: z.number().int(),
  /** one line from the reviewer's words */
  summary: z.string(),
  /** `.feedback/<id>` */
  dir: z.string(),
  folderUrl: z.string(),
  pullCommand: z.string(),
});
export type FeedbackListItem = z.infer<typeof feedbackListItemSchema>;

export const feedbackListSchema = z.object({
  items: z.array(feedbackListItemSchema),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  /** why the page ended early: the limit or the export's size cap */
  stoppedBy: z.enum(['limit', 'size']).nullable(),
  /** this page as an archive, and its INDEX.md */
  exportUrl: z.string(),
  indexUrl: z.string(),
  /** curl ... | tar xz for this page */
  pullCommand: z.string(),
});
export type FeedbackList = z.infer<typeof feedbackListSchema>;

export const exportFeedback = defineRoute({
  name: 'handoff.export',
  method: 'GET',
  path: api('/feedback/export'),
  auth: 'member',
  scope: 'read',
  query: feedbackFiltersSchema,
  response: 'binary',
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_query'],
  area: 'agent',
  tasks: ['P2-handoff'],
  summary:
    'Every matching capture at once, as a streamed gzipped tar (`curl ... | tar xz`): `.feedback/INDEX.md` (a table of the captures and digests across them) and one `.feedback/<id>/` folder per capture in the per-capture layout. Filters: workspace, project, folder, status (unresolved by default, resolved, all), since, until, kind, creator, limit. A page stops at `limit` captures or at the size cap (EXPORT_MAX_MB); the `x-next-cursor` header and a line in INDEX.md carry the cursor of the next page, whose index is INDEX-<n>.md.',
});

export const listAllFeedback = defineRoute({
  name: 'handoff.list',
  method: 'GET',
  path: api('/feedback'),
  auth: 'member',
  scope: 'read',
  query: feedbackFiltersSchema,
  response: feedbackListSchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_query'],
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'The captures the export would hold, as JSON: id, date, reviewer, route, outcome counts, one-line summary, folder URL and pull command of each, and the next-page cursor. Same filters and pages as /feedback/export.',
});

export const getFeedbackIndex = defineRoute({
  name: 'handoff.index',
  method: 'GET',
  path: api('/feedback/index'),
  auth: 'member',
  scope: 'read',
  query: feedbackFiltersSchema,
  response: 'markdown',
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_query'],
  area: 'agent',
  tasks: ['P2-handoff'],
  summary: 'INDEX.md of one export page without the folders: the table of captures and the digests across them (routes with the most problems, repeated console errors, failing requests, recurring words). Same filters and pages as /feedback/export.',
});

export const handoffAreaRoutes = [getFeedbackFolder, getFolderIndex, getFolderFile, getResolution, resolveFeedback, reopenFeedback, getSkill, exportFeedback, listAllFeedback, getFeedbackIndex] as const;
