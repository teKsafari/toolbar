import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { linkedIssuesOf } from '#lib/server/integrations/index.ts';

// J-241: issues filed from the capture or named in its text.
export const GET = apiRoute(ROUTES['integrations.linkedIssues'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'viewer' });
  return { items: await linkedIssuesOf(db, a.rec) };
});
