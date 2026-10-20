// The embed (D-210, D-211): a toolbar a site owner adds with a script tag or the
// `@open-toolbar/embed` package, keyed by a public per-project key bound to the project's origins.
// Reviewers have no account. The key's two public routes start a capture; everything after that
// goes through the `upload` routes with the capture's `tb_upl_` token, feedback items included.
// routes.ts spreads this list into ROUTE_LIST.
import { z } from 'zod';
import { createCaptureBodySchema, reviewerNameSchema } from './captures.ts';
import { api, defineRoute, idSchema } from './common.ts';
import { projectPresetSchema, projectSchema } from './projects.ts';

/** Prefix of a project's embed key: `tbk_` and 16 random bytes in base64url. */
export const EMBED_KEY_PREFIX = 'tbk_';
export const EMBED_KEY_RE = /^tbk_[A-Za-z0-9_-]{22}$/;

/**
 * The browser's Origin as it reached the server. server.js (and vite.config.ts in dev) copy it here
 * before they rewrite Origin for Bearer requests, and drop any value a client sent.
 */
export const REQUEST_ORIGIN_HEADER = 'x-toolbar-request-origin';

/** Capture kinds the embed makes: the reviewer toolbar's feedback, a comment's last minute, a trace. */
export const EMBED_CAPTURE_KINDS = ['feedback', 'replay', 'trace'] as const;

/** Files the server serves for the embed: the script, and `/embed/<file>` for fonts, chunks and the package. */
export const EMBED_SCRIPT_PATH = '/embed.js';
export const EMBED_FILES_PATH = '/embed';
export const EMBED_PACKAGE_FILE = 'open-toolbar-embed.tgz';

const keyParams = z.object({ key: z.string().min(1).max(100) });

export const embedConfigSchema = z.object({
  project: z.object({ id: idSchema, name: z.string() }),
  workspaceId: idSchema,
  maskingPreset: projectPresetSchema,
  bodyAllowlist: z.array(z.string()),
  traceOpenMs: z.number().int(),
  brand: z.object({ name: z.string(), accent: z.string() }),
});
export type EmbedConfig = z.infer<typeof embedConfigSchema>;

/** Who sends: a per-browser random id, and a name and email when the reviewer gave them. An email that is not one is dropped. */
export const embedReviewerSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: reviewerNameSchema.optional(),
  email: z
    .string()
    .max(200)
    .transform((s) => {
      const e = s.trim();
      return z.email().safeParse(e).success ? e : undefined;
    })
    .optional(),
});
export type EmbedReviewer = z.infer<typeof embedReviewerSchema>;

/** The `captures.create` body without workspace, folder and source (the key decides), and the reviewer. */
export const embedCreateBodySchema = createCaptureBodySchema.omit({ workspaceId: true, folderId: true, source: true }).extend({
  kind: z.enum(EMBED_CAPTURE_KINDS),
  reviewer: embedReviewerSchema.optional(),
});
export type EmbedCreateBody = z.input<typeof embedCreateBodySchema>;

export const embedCreatedSchema = z.object({
  id: idSchema,
  /** bearer for this capture's chunk, complete, finalize, asset and feedback calls; revoked when the key changes */
  uploadToken: z.string(),
});

export const embedConfig = defineRoute({
  name: 'embed.config',
  method: 'GET',
  path: api('/embed/:key/config'),
  auth: 'public',
  params: keyParams,
  response: embedConfigSchema,
  errors: ['not_found', 'origin_not_allowed'],
  area: 'dashboard',
  tasks: ['D-211'],
  summary: 'What the embedded toolbar needs for a project embed key: the project, masking preset, body allowlist, trace step window and branding. 404 for an unknown or turned-off key.',
});

export const embedCreateCapture = defineRoute({
  name: 'embed.createCapture',
  method: 'POST',
  path: api('/embed/:key/recordings'),
  auth: 'public',
  params: keyParams,
  body: embedCreateBodySchema,
  response: embedCreatedSchema,
  errors: ['not_found', 'origin_not_allowed', 'invalid_body', 'rate_limited', 'conflict'],
  area: 'dashboard',
  tasks: ['D-211'],
  summary:
    'Start a capture through a project embed key, from a page on one of the project origins. Visible to the workspace only. The upload token (tb_upl_) authorises chunk, complete, asset, feedback and finalize calls for this capture only, until the key is rotated or turned off (D-213). Through it: at most LIMITS.embedAssetCount assets of LIMITS.embedAssetBytes each and LIMITS.embedAssetTotalBytes in all, asset and feedback calls rate-limited per address, none later than LIMITS.embedWriteAfterFinalizeMs after finalize. Finalize takes reviewer.name, which fills an empty author name.',
});

const projectParams = z.object({ id: idSchema });

export const rotateEmbedKey = defineRoute({
  name: 'embed.rotateKey',
  method: 'POST',
  path: api('/projects/:id/embed-key'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: projectParams,
  response: projectSchema,
  status: 200,
  errors: ['not_found', 'forbidden'],
  area: 'dashboard',
  tasks: ['D-211'],
  summary: 'Turn the embed on for a project with a new key, or replace its key: the old one stops working at once.',
});

export const deleteEmbedKey = defineRoute({
  name: 'embed.deleteKey',
  method: 'DELETE',
  path: api('/projects/:id/embed-key'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: projectParams,
  response: projectSchema,
  errors: ['not_found', 'forbidden'],
  area: 'dashboard',
  tasks: ['D-211'],
  summary: 'Turn the embed off for a project: its key stops working.',
});

export const embedRoutes = [embedConfig, embedCreateCapture, rotateEmbedKey, deleteEmbedKey] as const;
