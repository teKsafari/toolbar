// Interaction spans of a capture (Part 2 traces): derived on request from events.json.gz by
// @toolbar/trace, so a capture made before traces existed has spans too. ?format=jsonl gives
// spans.jsonl, the file the agent folder carries.
import { ROUTES } from '@toolbar/shared/api';
import { deriveTrace, spansJsonl, timelineLines } from '@toolbar/trace';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { assertDevtools, loadEvents } from '#lib/server/mcp/data.ts';
import { traceConfigOf } from '#lib/server/projects.ts';

export const GET = apiRoute(ROUTES['captures.spans'], async ({ event, params, query }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'viewer' });
  assertDevtools(a);
  const events = await loadEvents(db, a.rec);
  if (!events) fail('conflict', `The capture's events are not ready (status ${a.rec.status}). Try again when it is ready.`);
  const startedAt = a.rec.startedAt?.getTime();
  const endedAt = startedAt !== undefined && a.rec.durationMs != null ? startedAt + a.rec.durationMs : undefined;
  const config = await traceConfigOf(db, a.rec);
  const trace = deriveTrace(events, { ...(startedAt !== undefined ? { startedAt } : {}), ...(endedAt !== undefined ? { endedAt } : {}), config });
  const items = query.outcome ? trace.spans.filter((s) => query.outcome!.includes(s.outcome)) : trace.spans;
  if (query.format === 'jsonl') {
    return new Response(spansJsonl(items), {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': `inline; filename="spans.jsonl"`,
        'cache-control': 'private, no-store',
      },
    });
  }
  return { items, summary: trace.summary, timeline: timelineLines(items) };
});
