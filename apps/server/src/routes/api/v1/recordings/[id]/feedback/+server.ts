// feedback.list and feedback.create: the reviewer toolbar's items on a capture (Part 2).
import { json } from '@sveltejs/kit';
import { ROUTES, UPLOAD_TOKEN_PREFIX } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { ApiFail, handle, jsonBody, memberAccess, viewerAccess } from '#lib/server/viewer/access.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { authorSnapshot } from '#lib/server/auth/author.ts';
import { ApiError, fail } from '#lib/server/share/http.ts';
import { createFeedbackItems, listFeedbackItems } from '#lib/server/feedback/service.ts';
import { mediaBase } from '#lib/server/viewer/detail.ts';
import { embedUploadWrite } from '#lib/server/embed/index.ts';

export const GET = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  return json({ items: await listFeedbackItems(ctx.rec.id, mediaBase(ctx.rec, ctx)) });
});

// A member (creator or more), or the upload token of an embed capture (D-211): then the items take
// the capture's author snapshot, within the embed's write limits (D-213). Other captures' upload
// tokens (recording links) add no items.
export const POST = handle(async (event) => {
  const bearer = (event.request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (bearer.startsWith(UPLOAD_TOKEN_PREFIX)) {
    let rec;
    try {
      ({ rec } = await captureAccess(db, event, event.params.id!, { mode: 'upload', role: 'creator', own: true }));
      if (rec.source !== 'embed') fail('forbidden', 'Only embed captures take feedback items with an upload token');
      await embedUploadWrite(db, event, rec);
    } catch (e) {
      if (e instanceof ApiError) throw new ApiFail(e.status, e.code, e.message);
      throw e;
    }
    const body = await jsonBody(event.request, ROUTES['feedback.create'].body);
    const who = { userId: rec.authorUserId, name: rec.authorName, email: rec.authorEmail, issuer: rec.authorIssuer, subject: rec.authorSubject };
    return json({ items: await createFeedbackItems(rec, who, body.items) }, { status: 201 });
  }
  const ctx = await memberAccess(event, event.params.id!, 'creator');
  const body = await jsonBody(event.request, ROUTES['feedback.create'].body);
  return json({ items: await createFeedbackItems(ctx.rec, await authorSnapshot(db, ctx.user!.id), body.items) }, { status: 201 });
});
