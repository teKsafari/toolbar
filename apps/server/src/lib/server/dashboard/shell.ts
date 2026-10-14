// Data the app shell needs on every page: folders for the sidebar, members for the header
// avatars and the creator filter, onboarding state.
import type { Db } from '../db/index.ts';
import { seatOf } from '../share/access.ts';
import { listFolders } from './folders.ts';
import { listMembers, onboarding } from './workspace.ts';

export async function shellData(db: Db, userId: string, workspaceId: string | null) {
  if (!workspaceId) return { folders: [], members: [], onboarding: null, seat: null };
  const seat = await seatOf(db, userId, workspaceId);
  if (!seat) return { folders: [], members: [], onboarding: null, seat: null };
  const [folders, members, ob] = await Promise.all([
    listFolders(db, workspaceId, { userId, seat }),
    listMembers(db, workspaceId),
    onboarding(db, userId, workspaceId),
  ]);
  return { folders, members, onboarding: ob, seat };
}
