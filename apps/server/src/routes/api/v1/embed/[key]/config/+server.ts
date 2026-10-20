import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { embedConfigOf } from '#lib/server/embed/index.ts';

// D-211: what the embedded toolbar boots from. Public; the page must be on a project origin.
export const GET = apiRoute(ROUTES['embed.config'], async ({ event, params }) => embedConfigOf(db, params.key, event.request.headers));
