// comments.addReaction and comments.removeReaction (J-130). Share-link viewers may react too.
import { json, type RequestEvent } from '@sveltejs/kit';
import { ROUTES } from '@toolbar/shared/api';
import { anonKeyOf, fail, handle, viewerAccess } from '#lib/server/viewer/access.ts';
import { commentRecording, react } from '#lib/server/viewer/comments.ts';

const run = (on: boolean) =>
  handle(async (event: RequestEvent) => {
    const p = ROUTES['comments.addReaction'].params.safeParse(event.params);
    if (!p.success) fail(404, 'not_found', 'Unknown reaction');
    const row = await commentRecording(event.params.id!);
    if (!row) fail(404, 'not_found', 'Comment not found');
    if (!event.locals.user) anonKeyOf(event.cookies, true);
    const ctx = await viewerAccess(event, row!.recordingId);
    if (!ctx.actor && !event.locals.user) {
      const key = anonKeyOf(event.cookies, true);
      ctx.anonKey = key;
      ctx.actor = `a:${key}`;
    }
    return json({ reactions: await react(ctx, row!, p.data!.key, on) });
  });

export const PUT = run(true);
export const DELETE = run(false);
