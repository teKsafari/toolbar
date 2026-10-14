import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { recorderInfo } from '#lib/server/dashboard/links.ts';

// J-017, J-126: what the recipient's recorder page shows. Public.
export const GET = apiRoute(ROUTES['recordingLinks.recorder'], async ({ params, query }) => recorderInfo(db, params.token, query));
