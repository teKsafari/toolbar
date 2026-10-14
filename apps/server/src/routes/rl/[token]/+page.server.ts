import { db } from '#lib/server/db/index.ts';
import { recorderInfo } from '#lib/server/dashboard/links.ts';
import { ApiError } from '#lib/server/share/http.ts';

// J-017, J-126: the recorder page for whoever opens a recording link. No account needed.
export const load = async ({ params, url, setHeaders }) => {
  setHeaders({ 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' });
  const q = { title: url.searchParams.get('title') ?? undefined, mic: (url.searchParams.get('mic') === '1' ? '1' : undefined) as '1' | undefined };
  try {
    return {
      info: await recorderInfo(db, params.token, q),
      preset: { folder: url.searchParams.get('folder'), ref: url.searchParams.get('ref') },
      state: 'ok' as const,
    };
  } catch (e) {
    if (e instanceof ApiError) return { info: null, preset: null, state: e.code === 'revoked' ? ('revoked' as const) : ('missing' as const) };
    throw e;
  }
};
