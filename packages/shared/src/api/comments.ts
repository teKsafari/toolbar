// Comments on a capture: threads, replies, timestamps, reactions, resolve, live updates.
import { z } from 'zod';
import { api, defineRoute, idSchema, isoSchema, okSchema, pageOf, pageQuerySchema, personSchema } from './common.ts';
import { assetSchema } from './captures.ts';

/**
 * The eight fixed reactions (J-130), stored and sent by key. The UI draws its own glyph for
 * each key; no emoji characters live in code.
 */
export const REACTION_KEYS = ['thumbs-up', 'thumbs-down', 'heart', 'laugh', 'party', 'eyes', 'check', 'question'] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

export const reactionSchema = z.object({ key: z.enum(REACTION_KEYS), count: z.number().int().positive(), mine: z.boolean() });

export const commentSchema = z.object({
  id: idSchema,
  recordingId: idSchema,
  parentId: idSchema.nullable(),
  /** null when anonymous (J-134) or the account was deleted (J-225) */
  author: personSchema.nullable(),
  anonymous: z.boolean(),
  /** shown with a letter avatar for anonymous comments */
  displayName: z.string(),
  /** Markdown; mentions as `@[Name](user:<uuid>)` */
  body: z.string(),
  /** playback time in ms (J-127); null for untimed comments */
  tMs: z.number().int().nonnegative().nullable(),
  attachments: z.array(assetSchema),
  reactions: z.array(reactionSchema),
  mentions: z.array(idSchema),
  createdAt: isoSchema,
  editedAt: isoSchema.nullable(),
  resolvedAt: isoSchema.nullable(),
  resolvedBy: personSchema.nullable(),
  canEdit: z.boolean(),
});
export type Comment = z.infer<typeof commentSchema>;

export const commentThreadSchema = commentSchema.extend({ replies: z.array(commentSchema) });
export type CommentThread = z.infer<typeof commentThreadSchema>;

const recordingIdParams = z.object({ id: idSchema });
const commentIdParams = z.object({ id: idSchema });

export const listComments = defineRoute({
  name: 'comments.list',
  method: 'GET',
  path: api('/recordings/:id/comments'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  query: pageQuerySchema.extend({ includeResolved: z.coerce.boolean().default(true) }),
  response: pageOf(commentThreadSchema),
  area: 'viewer',
  tasks: ['J-127', 'J-128', 'J-149'],
  summary: 'Top-level comments, oldest first, each with its replies.',
});

export const createCommentBodySchema = z
  .object({
    body: z.string().max(10_000).default(''),
    parentId: idSchema.optional(),
    tMs: z.number().int().nonnegative().optional(),
    attachmentAssetIds: z.array(idSchema).max(10).default([]),
    mentions: z.array(idSchema).max(50).default([]),
    /** name for an anonymous comment from a share-link viewer (J-134); ignored when signed in */
    anonName: z.string().max(80).optional(),
  })
  .refine((c) => c.body.trim() !== '' || c.attachmentAssetIds.length > 0, 'A comment needs text or an image');

export const createComment = defineRoute({
  name: 'comments.create',
  method: 'POST',
  path: api('/recordings/:id/comments'),
  auth: 'viewer',
  scope: 'write',
  params: recordingIdParams,
  body: createCommentBodySchema,
  response: commentSchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_body', 'rate_limited'],
  area: 'viewer',
  tasks: ['J-127', 'J-132', 'J-134', 'J-135', 'J-151'],
  summary: 'Post a comment or reply, optionally pinned to a playback time; mentions email the members.',
});

export const updateComment = defineRoute({
  name: 'comments.update',
  method: 'PATCH',
  path: api('/comments/:id'),
  auth: 'member',
  scope: 'write',
  params: commentIdParams,
  body: z.object({ body: z.string().min(1).max(10_000) }),
  response: commentSchema,
  area: 'viewer',
  tasks: ['J-131'],
  summary: 'Edit your own comment; sets editedAt.',
});

export const deleteComment = defineRoute({
  name: 'comments.delete',
  method: 'DELETE',
  path: api('/comments/:id'),
  auth: 'member',
  scope: 'write',
  params: commentIdParams,
  response: okSchema,
  area: 'viewer',
  tasks: ['J-131', 'J-151'],
  summary: 'Delete your own comment (admins may delete any).',
});

export const resolveComment = defineRoute({
  name: 'comments.resolve',
  method: 'POST',
  path: api('/comments/:id/resolve'),
  auth: 'member',
  scope: 'write',
  params: commentIdParams,
  body: z.object({ resolved: z.boolean() }),
  response: commentSchema,
  status: 200,
  area: 'viewer',
  tasks: ['J-151'],
  summary: 'Resolve or reopen a thread (agents close the loop on a capture this way).',
});

const reactionParams = z.object({ id: idSchema, key: z.enum(REACTION_KEYS) });

export const addReaction = defineRoute({
  name: 'comments.addReaction',
  method: 'PUT',
  path: api('/comments/:id/reactions/:key'),
  auth: 'viewer',
  scope: 'write',
  params: reactionParams,
  response: z.object({ reactions: z.array(reactionSchema) }),
  area: 'viewer',
  tasks: ['J-130', 'J-151'],
  summary: 'Add your reaction (idempotent).',
});

export const removeReaction = defineRoute({
  name: 'comments.removeReaction',
  method: 'DELETE',
  path: api('/comments/:id/reactions/:key'),
  auth: 'viewer',
  scope: 'write',
  params: reactionParams,
  response: z.object({ reactions: z.array(reactionSchema) }),
  area: 'viewer',
  tasks: ['J-130', 'J-151'],
  summary: 'Remove your reaction.',
});

export const commentStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('created'), comment: commentSchema }),
  z.object({ type: z.literal('updated'), comment: commentSchema }),
  z.object({ type: z.literal('deleted'), id: idSchema }),
  z.object({ type: z.literal('reactions'), id: idSchema, reactions: z.array(reactionSchema) }),
]);

export const commentStream = defineRoute({
  name: 'comments.stream',
  method: 'GET',
  path: api('/recordings/:id/comments/stream'),
  auth: 'viewer',
  params: recordingIdParams,
  response: 'sse',
  area: 'viewer',
  tasks: ['J-133'],
  summary: 'Server-sent events with commentStreamEventSchema payloads, so two viewers see each other live.',
});

export const commentRoutes = [
  listComments,
  createComment,
  updateComment,
  deleteComment,
  resolveComment,
  addReaction,
  removeReaction,
  commentStream,
] as const;
