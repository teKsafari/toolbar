import { error } from '@sveltejs/kit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stub: the viewer area agent loads the recording, events and media here.
export const load = ({ params }) => {
  if (!UUID.test(params.id)) error(404, 'Capture not found');
  return { id: params.id };
};
