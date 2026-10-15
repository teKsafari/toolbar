// feedback.list and feedback.create: the reviewer toolbar's items on a capture (Part 2).
import { json } from '@sveltejs/kit';
import { ROUTES } from '@toolbar/shared/api';
import { handle, jsonBody, memberAccess, viewerAccess } from '#lib/server/viewer/access.ts';
import { createFeedbackItems, listFeedbackItems } from '#lib/server/feedback/service.ts';
import { mediaBase } from '#lib/server/viewer/detail.ts';

export const GET = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  return json({ items: await listFeedbackItems(ctx.rec.id, mediaBase(ctx.rec, ctx)) });
});

export const POST = handle(async (event) => {
  const ctx = await memberAccess(event, event.params.id!, 'creator');
  const body = await jsonBody(event.request, ROUTES['feedback.create'].body);
  return json({ items: await createFeedbackItems(ctx.rec, ctx.user!.id, body.items) }, { status: 201 });
});
