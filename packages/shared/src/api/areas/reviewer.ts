// Routes of the in-page reviewer toolbar (Part 2): feedback items on a capture.
// routes.ts spreads this list into ROUTE_LIST.
import { z } from 'zod';
import { feedbackItemInputSchema, feedbackItemSchema } from '../../areas/reviewer.ts';
import { api, defineRoute, idSchema } from '../common.ts';

export const createFeedbackBodySchema = z.object({
  items: z.array(feedbackItemInputSchema).min(1).max(100),
});

export const createFeedback = defineRoute({
  name: 'feedback.create',
  method: 'POST',
  path: api('/recordings/:id/feedback'),
  auth: 'upload',
  role: 'creator',
  scope: 'write',
  params: z.object({ id: idSchema }),
  body: createFeedbackBodySchema,
  response: z.object({ items: z.array(feedbackItemSchema) }),
  status: 201,
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_body'],
  area: 'capture',
  tasks: ['P2-reviewer'],
  summary:
    'Add the reviewer toolbar feedback items (element, text, drawing, element screenshot, voice note) to a capture, before or after it is finalized. Idempotent on clientId. Voice notes are transcribed in the background. With the upload token of the capture (the embed, D-211) the items take the author of the capture.',
});

export const listFeedback = defineRoute({
  name: 'feedback.list',
  method: 'GET',
  path: api('/recordings/:id/feedback'),
  auth: 'viewer',
  scope: 'read',
  params: z.object({ id: idSchema }),
  response: z.object({ items: z.array(feedbackItemSchema) }),
  errors: ['unauthorized', 'forbidden', 'not_found'],
  area: 'capture',
  tasks: ['P2-reviewer'],
  summary: 'Feedback items of a capture in pin order, with crop and voice URLs, transcripts and the errors and failed requests each one attached.',
});

export const reviewerAreaRoutes = [createFeedback, listFeedback] as const;
