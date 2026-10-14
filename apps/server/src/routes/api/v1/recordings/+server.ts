import { createRecordingSchema } from '@toolbar/shared';
import { notImplemented, parseBody, requireUser } from '#lib/server/api.ts';

// Stub: the upload area agent implements creation (idempotent on clientId) and listing.
export const POST = async (event) => {
  requireUser(event);
  await parseBody(event, createRecordingSchema);
  return notImplemented('Creating recordings');
};

export const GET = (event) => {
  requireUser(event);
  return notImplemented('Listing recordings');
};
