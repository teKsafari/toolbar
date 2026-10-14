// Share page (J-121, J-118): anyone with the link sees the capture; workspace-only links need
// a signed-in member. Members of the capture's workspace go to the member page instead.
import { error, redirect } from '@sveltejs/kit';
import { ApiFail, anonKeyOf, findShareLink, viewerAccess } from '#lib/server/viewer/access.ts';
import { viewerPageData } from '#lib/server/viewer/page.ts';

export const load = async (event) => {
  const { token } = event.params;
  const link = await findShareLink(token);
  if (!link) error(404, 'Capture not found');
  const user = event.locals.user;
  if (!user) anonKeyOf(event.cookies, true);
  try {
    const ctx = await viewerAccess(event, link.recordingId, { token });
    if (ctx.role && event.url.searchParams.get('devtools') !== '0') {
      const q = new URLSearchParams(event.url.search);
      redirect(303, `/c/${ctx.rec.id}${q.size ? `?${q}` : ''}`);
    }
    return { viewer: await viewerPageData(event, ctx, 'share') };
  } catch (e) {
    if (e instanceof ApiFail) {
      if (e.status === 401) redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
      error(404, 'Capture not found');
    }
    throw e;
  }
};
