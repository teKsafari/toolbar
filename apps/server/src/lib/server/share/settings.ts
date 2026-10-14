// Share settings of a capture and token resolution for the share routes (X-03, J-117 to J-121).
import type { RequestEvent } from '@sveltejs/kit';
import type { ShareSettings } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { fail } from './http.ts';
import { seatOf, folderPrivacyOf, memberCanSee, type RecordingRow } from './access.ts';
import { ensureDefaultLinks, findShare, shareLinkDtos } from './tokens.ts';

export async function shareSettings(db: Db, rec: RecordingRow, userId: string | null): Promise<ShareSettings> {
  const { link, contentOnly, all } = await ensureDefaultLinks(db, rec, userId);
  const dtos = await shareLinkDtos(db, all);
  return { access: rec.access, link: dtos.get(link.id)!, contentOnlyLink: dtos.get(contentOnly.id)!, links: all.map((r) => dtos.get(r.id)!) };
}

/**
 * Resolve a share token for /api/v1/share/:token and /s/:token/media. Unknown, revoked, expired,
 * deleted and not-yet-created all read as 404. Workspace-only captures need a signed-in member:
 * 401 when signed out, 404 for anyone else.
 */
export async function resolveShareFor(db: Db, event: RequestEvent, token: string) {
  const found = await findShare(db, token);
  if (!found) fail('not_found', 'Link not found');
  const { rec, link } = found;
  if (rec.access === 'workspace') {
    const userId = event.locals.user?.id;
    if (!userId) fail('unauthorized', 'Sign in to see this capture');
    const seat = await seatOf(db, userId, rec.organizationId);
    if (!seat || !memberCanSee(seat, userId, rec, await folderPrivacyOf(db, rec.folderId))) fail('not_found', 'Link not found');
  }
  return { rec, link };
}
