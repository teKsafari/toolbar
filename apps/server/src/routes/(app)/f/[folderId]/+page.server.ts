import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { folderFor, toFolders } from '#lib/server/dashboard/folders.ts';
import { ApiError } from '#lib/server/share/http.ts';

// J-162: folders open by their 4-character id (or uuid).
export const load = async ({ params, locals }) => {
  if (!locals.user) error(401, 'Sign in');
  try {
    const { f, seat } = await folderFor(db, params.folderId, locals.user.id);
    const [folder] = await toFolders(db, [f], { userId: locals.user.id, seat });
    return { folder: folder!, seat };
  } catch (e) {
    if (e instanceof ApiError) error(404, 'This folder does not exist, or it is private.');
    throw e;
  }
};
