// Routes the server-core area adds beyond the base contract. Only the server-core area edits this file.
import { z } from 'zod';
import { api, defineRoute, idSchema } from '../common.ts';

/** Asset bytes for assets not tied to a capture (avatars, logos, unattached uploads). */
export const getAsset = defineRoute({
  name: 'core.asset',
  method: 'GET',
  path: api('/assets/:id'),
  auth: 'public',
  params: z.object({ id: idSchema }),
  response: 'binary',
  errors: ['not_found', 'unauthorized'],
  area: 'server-core',
  tasks: ['X-01'],
  summary:
    'Bytes of an asset with Range support. Avatars and logos are public by id; other unattached assets only for their uploader; capture assets redirect to the capture media route.',
});

export const serverCoreAreaRoutes = [getAsset] as const;
