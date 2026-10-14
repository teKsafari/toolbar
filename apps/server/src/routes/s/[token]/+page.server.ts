import { error } from '@sveltejs/kit';

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

// Stub: the sharing area agent resolves the token (sha256 lookup, expiry, revocation).
export const load = ({ params }) => {
  if (!TOKEN.test(params.token)) error(404, 'Link not found');
  error(404, 'Link not found');
};
