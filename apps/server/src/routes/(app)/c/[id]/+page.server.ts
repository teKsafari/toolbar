// Member capture page. The page resets to the root layout (+layout@.svelte), so it checks the
// session itself instead of relying on (app)/+layout.server.ts.
import { error, redirect } from '@sveltejs/kit';
import { ApiFail, viewerAccess } from '#lib/server/viewer/access.ts';
import { viewerPageData } from '#lib/server/viewer/page.ts';

export const load = async (event) => {
  if (!event.locals.user) redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
  try {
    const ctx = await viewerAccess(event, event.params.id, { token: null });
    if (!ctx.role) error(404, 'Capture not found');
    return { viewer: await viewerPageData(event, ctx, 'member') };
  } catch (e) {
    if (e instanceof ApiFail) error(404, 'Capture not found');
    throw e;
  }
};
