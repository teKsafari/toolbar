// Routes of the agent hand-off (PLAN "Hand-off to the agent"): the feedback folder as a tar.gz,
// its file listing and single files (the MCP tools read the same), resolving feedback, and the
// Agent Skill. routes.ts spreads this list into ROUTE_LIST.
import { z } from 'zod';
import { api, defineRoute, idSchema, isoSchema, okSchema } from '../common.ts';

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
});
export type Resolution = z.infer<typeof resolutionSchema>;

export const resolveBodySchema = z.object({
  /** one or two sentences: the cause and the fix */
  note: z.string().trim().max(4000).optional(),
  /** commit or PR that fixed it */
  commit: z.string().trim().max(200).optional(),
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
  summary: 'Mark the feedback resolved, with a note on the cause and fix and the commit; fires the feedback.resolved webhook.',
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

export const handoffAreaRoutes = [getFeedbackFolder, getFolderIndex, getFolderFile, getResolution, resolveFeedback, reopenFeedback, getSkill] as const;
