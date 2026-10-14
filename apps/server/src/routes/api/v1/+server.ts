import { json } from '@sveltejs/kit';
import { version } from '$app/env';
import { PRODUCT_NAME } from '@toolbar/shared';

/** API index. Route stubs live under this folder; area agents fill them in. */
export const GET = () =>
  json({
    name: PRODUCT_NAME,
    version,
    endpoints: [
      'GET  /api/v1/me',
      'POST /api/v1/recordings',
      'PUT  /api/v1/recordings/:id/streams/:stream/chunks/:seq',
      'GET  /api/v1/recordings/:id/streams/:stream/chunks',
      'POST /api/v1/recordings/:id/streams/:stream/complete',
      'POST /api/v1/recordings/:id/finalize',
      'POST /api/v1/assets',
      'POST /api/v1/ext/token',
    ],
  });
