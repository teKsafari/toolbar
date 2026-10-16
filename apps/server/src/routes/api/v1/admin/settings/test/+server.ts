// POST /api/v1/admin/settings/test (instance admins, D-187): try the transcription provider or
// the OIDC discovery document with the form's values; nothing is stored.
import { ROUTES } from '@toolbar/shared/api';
import { apiRoute } from '#lib/server/share/http.ts';
import { probeOidc, probeTranscription } from '#lib/server/settings/probe.ts';
import { instanceAdmin } from '../guard.ts';

export const POST = apiRoute(ROUTES['instanceSettings.test'], async ({ event, body }) => {
  await instanceAdmin(event);
  return body.target === 'oidc' ? probeOidc(body.values) : probeTranscription(body.values);
});
