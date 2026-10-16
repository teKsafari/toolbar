// STUB (injector branch, D-200). The site-access work (automatic per-origin projects, D-198)
// owns this helper and ships the real one in apps/server/src/lib/server/projects/. When the two
// branches merge, take THEIR implementation and delete this file; the injector code reaches it
// only through apps/server/src/lib/server/review/access.ts, which then imports theirs.
//
// Contract: may the person with `userId` get a reviewer cookie for `origin` (an origin as
// normalizeOrigin returns it)? When allowed, the project the origin belongs to and its workspace.
// This stub allows an origin of a project in one of the person's workspaces (the D-123 rule).
import { projectForUrl } from '@toolbar/shared/projects';
import type { Db } from '../db/index.ts';
import { projectsOfUser } from '../projects.ts';

export async function reviewOriginAllowed(db: Db, origin: string, userId: string): Promise<{ allowed: boolean; projectId?: string; workspaceId?: string }> {
  const p = projectForUrl(await projectsOfUser(db, userId), `${origin}/`);
  return p ? { allowed: true, projectId: p.id, workspaceId: p.workspaceId } : { allowed: false };
}
