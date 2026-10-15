// Integrations: GitHub and GitLab issues through a personal access token, Slack through an
// incoming webhook URL, and signed outgoing webhooks (docs/tasks.md proposed decisions,
// docs/skip-list.md for the trackers left out). Secrets are write-only: no response returns them.
import { z } from 'zod';
import { RECORDING_KINDS } from '../constants.ts';
import { envInfoSchema } from '../schemas.ts';
import { api, defineRoute, idSchema, isoSchema, okSchema, pageOf, pageQuerySchema, personSchema } from './common.ts';
import { CAPTURE_SOURCES, linkedIssueSchema } from './captures.ts';

/** Integration types built in Part 1. INTEGRATION_TYPES in constants.ts also names skipped ones. */
export const BUILT_INTEGRATIONS = ['github', 'gitlab', 'slack'] as const;
export type BuiltIntegration = (typeof BUILT_INTEGRATIONS)[number];

export const connectIntegrationBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('github'),
    name: z.string().max(100).optional(),
    token: z.string().min(10),
    /** GitHub Enterprise API root, if not github.com */
    baseUrl: z.string().url().default('https://api.github.com'),
    defaultRepo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  }),
  z.object({
    type: z.literal('gitlab'),
    name: z.string().max(100).optional(),
    token: z.string().min(10),
    baseUrl: z.string().url().default('https://gitlab.com'),
    defaultProject: z.string().optional(),
  }),
  z.object({
    type: z.literal('slack'),
    name: z.string().max(100).optional(),
    /** https://hooks.slack.com/services/... */
    webhookUrl: z.string().url(),
    channelLabel: z.string().max(100).optional(),
  }),
]);
export type ConnectIntegrationBody = z.input<typeof connectIntegrationBodySchema>;

export const integrationSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  type: z.enum(BUILT_INTEGRATIONS),
  name: z.string(),
  /** account login the token belongs to, or the channel label */
  account: z.string().nullable(),
  baseUrl: z.string().nullable(),
  defaultTarget: z.string().nullable(),
  status: z.enum(['ok', 'error']),
  lastError: z.string().nullable(),
  createdBy: personSchema.nullable(),
  createdAt: isoSchema,
});
export type Integration = z.infer<typeof integrationSchema>;

const workspaceParams = z.object({ workspaceId: idSchema });
const integrationParams = z.object({ id: idSchema });

export const listIntegrations = defineRoute({
  name: 'integrations.list',
  method: 'GET',
  path: api('/workspaces/:workspaceId/integrations'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  params: workspaceParams,
  response: z.object({ items: z.array(integrationSchema) }),
  area: 'dashboard',
  tasks: ['J-139', 'J-251', 'J-079', 'J-138'],
  summary: 'Connected apps of a workspace (the draft destination menu and send-to-app list read this).',
  paused: ['trackers', 'slack'],
});

export const connectIntegration = defineRoute({
  name: 'integrations.connect',
  method: 'POST',
  path: api('/workspaces/:workspaceId/integrations'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: workspaceParams,
  body: connectIntegrationBodySchema,
  response: integrationSchema,
  errors: ['unauthorized', 'forbidden', 'invalid_body', 'integration_failed'],
  area: 'dashboard',
  tasks: ['J-139'],
  summary: 'Store a token or webhook URL (encrypted) after a test call; 502 integration_failed when the test fails.',
  paused: ['trackers', 'slack'],
});

export const updateIntegration = defineRoute({
  name: 'integrations.update',
  method: 'PATCH',
  path: api('/integrations/:id'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: integrationParams,
  body: z
    .object({ name: z.string().max(100), token: z.string().min(10), webhookUrl: z.string().url(), defaultTarget: z.string().nullable() })
    .partial(),
  response: integrationSchema,
  area: 'dashboard',
  tasks: ['J-139'],
  summary: 'Rename, rotate the token or URL, or change the default repo or project.',
  paused: ['trackers', 'slack'],
});

export const removeIntegration = defineRoute({
  name: 'integrations.remove',
  method: 'DELETE',
  path: api('/integrations/:id'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: integrationParams,
  response: okSchema,
  area: 'dashboard',
  tasks: ['J-139'],
  summary: 'Disconnect an app.',
  paused: ['trackers', 'slack'],
});

/** Picker data for the tracker field form (J-140). */
export const integrationOptionsSchema = z.object({
  repos: z.array(z.object({ id: z.string(), fullName: z.string() })),
  labels: z.array(z.object({ name: z.string(), color: z.string().nullable() })),
  assignees: z.array(z.object({ login: z.string(), name: z.string().nullable(), avatarUrl: z.string().nullable() })),
  milestones: z.array(z.object({ id: z.string(), title: z.string() })),
});

export const integrationOptions = defineRoute({
  name: 'integrations.options',
  method: 'GET',
  path: api('/integrations/:id/options'),
  auth: 'member',
  role: 'creator',
  scope: 'read',
  params: integrationParams,
  query: z.object({ repo: z.string().optional(), q: z.string().optional() }),
  response: integrationOptionsSchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'integration_failed'],
  area: 'dashboard',
  tasks: ['J-140'],
  summary: 'Repos (or projects), labels, assignees and milestones from the tracker API.',
  paused: ['trackers', 'slack'],
});

/** Fields of a tracker issue or Slack post. Unknown keys are ignored per type. */
export const issueFieldsSchema = z.object({
  /** "owner/repo" for GitHub, project path or id for GitLab */
  repo: z.string().optional(),
  title: z.string().max(256).optional(),
  labels: z.array(z.string()).max(20).default([]),
  assignees: z.array(z.string()).max(10).default([]),
  milestone: z.string().optional(),
  /** extra text for a Slack post */
  message: z.string().max(4000).optional(),
});

export const sendToIntegration = defineRoute({
  name: 'integrations.send',
  method: 'POST',
  path: api('/recordings/:id/send'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: z.object({ id: idSchema }),
  body: z.object({ integrationId: idSchema, fields: issueFieldsSchema.default({ labels: [], assignees: [] }) }),
  response: linkedIssueSchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_body', 'integration_failed'],
  area: 'dashboard',
  tasks: ['J-137', 'J-138', 'J-242', 'J-241'],
  summary:
    'File an issue (or post to Slack) for an existing capture. Body per J-242: title, description, console errors, failing requests, URL, time, device and the capture link.',
  paused: ['trackers', 'slack'],
});

export const listLinkedIssues = defineRoute({
  name: 'integrations.linkedIssues',
  method: 'GET',
  path: api('/recordings/:id/issues'),
  auth: 'viewer',
  scope: 'read',
  params: z.object({ id: idSchema }),
  response: z.object({ items: z.array(linkedIssueSchema) }),
  area: 'dashboard',
  tasks: ['J-241'],
  summary: 'Issues filed from the capture or referenced in its text ("org/repo#12").',
  paused: ['trackers', 'slack'],
});

// ---------- outgoing webhooks ----------

export const WEBHOOK_EVENTS = ['capture.created', 'capture.deleted', 'comment.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Signature header on every delivery: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>`.
 * Receivers reject deliveries older than five minutes.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-nib-signature';
export const WEBHOOK_EVENT_HEADER = 'x-nib-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-nib-delivery';

export const webhookSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  url: z.string(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  active: z.boolean(),
  createdAt: isoSchema,
  lastDelivery: z.object({ at: isoSchema, ok: z.boolean(), status: z.number().int().nullable() }).nullable(),
});

export const listWebhooks = defineRoute({
  name: 'webhooks.list',
  method: 'GET',
  path: api('/workspaces/:workspaceId/webhooks'),
  auth: 'member',
  role: 'admin',
  scope: 'read',
  params: workspaceParams,
  response: z.object({ items: z.array(webhookSchema) }),
  area: 'dashboard',
  tasks: ['J-142'],
  summary: 'Webhook endpoints.',
});

export const createWebhook = defineRoute({
  name: 'webhooks.create',
  method: 'POST',
  path: api('/workspaces/:workspaceId/webhooks'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: workspaceParams,
  body: z.object({ url: z.string().url(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).default([...WEBHOOK_EVENTS]) }),
  response: z.object({ webhook: webhookSchema, /** shown once */ secret: z.string() }),
  area: 'dashboard',
  tasks: ['J-142'],
  summary: 'Add an endpoint; the signing secret is returned once.',
});

export const updateWebhook = defineRoute({
  name: 'webhooks.update',
  method: 'PATCH',
  path: api('/webhooks/:id'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: z.object({ id: idSchema }),
  body: z.object({ url: z.string().url(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1), active: z.boolean() }).partial(),
  response: webhookSchema,
  area: 'dashboard',
  tasks: ['J-142'],
  summary: 'Change URL, events or pause an endpoint.',
});

export const deleteWebhook = defineRoute({
  name: 'webhooks.delete',
  method: 'DELETE',
  path: api('/webhooks/:id'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: z.object({ id: idSchema }),
  response: okSchema,
  area: 'dashboard',
  tasks: ['J-142'],
  summary: 'Remove an endpoint.',
});

export const webhookDeliverySchema = z.object({
  id: idSchema,
  event: z.enum(WEBHOOK_EVENTS),
  status: z.enum(['pending', 'ok', 'failed']),
  attempts: z.number().int().nonnegative(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: isoSchema,
  nextAttemptAt: isoSchema.nullable(),
});

export const listDeliveries = defineRoute({
  name: 'webhooks.deliveries',
  method: 'GET',
  path: api('/webhooks/:id/deliveries'),
  auth: 'member',
  role: 'admin',
  scope: 'read',
  params: z.object({ id: idSchema }),
  query: pageQuerySchema,
  response: pageOf(webhookDeliverySchema),
  area: 'dashboard',
  tasks: ['J-142'],
  summary: 'Delivery log with attempts (retries back off over about a day).',
});

export const testWebhook = defineRoute({
  name: 'webhooks.test',
  method: 'POST',
  path: api('/webhooks/:id/test'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: z.object({ id: idSchema }),
  response: webhookDeliverySchema,
  area: 'dashboard',
  tasks: ['J-142'],
  summary: 'Send a signed test delivery now.',
});

/** Body of a webhook delivery. */
export const webhookPayloadSchema = z.object({
  id: idSchema,
  event: z.enum(WEBHOOK_EVENTS),
  createdAt: isoSchema,
  workspaceId: idSchema,
  data: z.object({
    capture: z.object({
      id: idSchema,
      kind: z.enum(RECORDING_KINDS),
      source: z.enum(CAPTURE_SOURCES),
      title: z.string(),
      url: z.string(),
      pageUrl: z.string().nullable(),
      author: personSchema.nullable(),
      env: envInfoSchema.nullable(),
      mediaUrls: z.array(z.string()),
      createdAt: isoSchema,
    }),
    comment: z.object({ id: idSchema, body: z.string(), tMs: z.number().nullable(), author: personSchema.nullable() }).optional(),
  }),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

export const integrationRoutes = [
  listIntegrations,
  connectIntegration,
  updateIntegration,
  removeIntegration,
  integrationOptions,
  sendToIntegration,
  listLinkedIssues,
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listDeliveries,
  testWebhook,
] as const;
