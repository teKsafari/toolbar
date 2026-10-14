// Routes the dashboard area adds beyond the base contract. Only the dashboard area edits this file.
// Define each with defineRoute() (see ../captures.ts for examples) and list it below;
// routes.ts already spreads this list into ROUTE_LIST.
import { z } from 'zod';
import { ONBOARDING_STEPS } from '../../areas/dashboard.ts';
import { api, defineRoute, idSchema } from '../common.ts';
import { captureCreatedSchema } from '../captures.ts';

/** J-020: upload an existing video (multipart: `file`, optional `workspaceId`, `folderId`, `title`). */
export const uploadVideo = defineRoute({
  name: 'captures.uploadVideo',
  method: 'POST',
  path: api('/recordings/upload'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  body: 'multipart',
  response: captureCreatedSchema,
  errors: ['unauthorized', 'forbidden', 'invalid_body', 'too_large', 'unsupported_media_type'],
  area: 'dashboard',
  tasks: ['J-020'],
  summary: 'Make a video capture with no logs from an MP4, WebM or MOV file of at most 200 MB; the server converts it to WebM.',
});

export const onboardingSchema = z.object({
  steps: z.array(z.object({ id: z.enum(ONBOARDING_STEPS.map((s) => s.id) as [string, ...string[]]), label: z.string(), href: z.string(), done: z.boolean() })),
  dismissed: z.boolean(),
});

/** J-169: the sidebar checklist. */
export const getOnboarding = defineRoute({
  name: 'dashboard.onboarding',
  method: 'GET',
  path: api('/me/onboarding'),
  auth: 'member',
  scope: 'read',
  query: z.object({ workspaceId: idSchema.optional() }),
  response: onboardingSchema,
  area: 'dashboard',
  tasks: ['J-169'],
  summary: 'Setup steps with their done state, and whether the card was dismissed.',
});

export const dismissOnboarding = defineRoute({
  name: 'dashboard.dismissOnboarding',
  method: 'POST',
  path: api('/me/onboarding/dismiss'),
  auth: 'member',
  scope: 'write',
  response: z.object({ ok: z.literal(true) }),
  status: 200,
  area: 'dashboard',
  tasks: ['J-169'],
  summary: 'Hide the setup card for good.',
});

export const dashboardAreaRoutes = [uploadVideo, getOnboarding, dismissOnboarding] as const;
