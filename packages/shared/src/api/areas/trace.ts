// Routes of Part 2 traces (packages/trace): interaction spans derived from a capture's events.
// routes.ts spreads this list into ROUTE_LIST.
import { z } from 'zod';
import { api, defineRoute, idSchema } from '../common.ts';

export const SPAN_OUTCOMES = ['changed', 'error', 'dead', 'stuck', 'silent', 'note'] as const;

/** One interaction span: the fields every client reads. The full shape is `Span` in @toolbar/trace. */
export const spanSchema = z
  .object({
    id: z.string(),
    t0: z.number(),
    t1: z.number(),
    startMs: z.number(),
    durationMs: z.number(),
    url: z.string(),
    action: z.object({ type: z.string(), label: z.string() }),
    outcome: z.enum(SPAN_OUTCOMES),
    silent: z.enum(['2xx', '4xx', '5xx', 'network']).optional(),
    closeReason: z.string(),
    summary: z.string(),
    causedBy: z.array(z.object({ span: z.string(), confidence: z.number(), reason: z.string() })),
    keyframes: z.array(z.string()),
  });

export const traceSummarySchema = z.object({
  startedAt: z.number(),
  endedAt: z.number(),
  spans: z.number().int(),
  outcomes: z.record(z.enum(SPAN_OUTCOMES), z.number().int()),
  attention: z.array(z.string()),
  unattributed: z.number().int(),
});

export const spansQuerySchema = z.object({
  /** `jsonl` returns spans.jsonl (application/x-ndjson), one span per line. */
  format: z.enum(['json', 'jsonl']).default('json'),
  outcome: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(SPAN_OUTCOMES)).optional()),
});

export const captureSpans = defineRoute({
  name: 'captures.spans',
  method: 'GET',
  path: api('/recordings/:id/spans'),
  auth: 'viewer',
  scope: 'read',
  params: z.object({ id: idSchema }),
  query: spansQuerySchema,
  response: z.object({ items: z.array(spanSchema), summary: traceSummarySchema, timeline: z.array(z.string()) }),
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_query', 'conflict'],
  area: 'agent',
  tasks: ['P2-trace'],
  summary: 'Interaction spans of a capture with their outcomes (changed, error, dead, stuck, silent), derived from its events; ?format=jsonl gives spans.jsonl.',
});

export const traceAreaRoutes = [captureSpans] as const;
