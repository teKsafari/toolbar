// The one place the injector's server code asks whether a reviewer cookie may be signed for an
// origin (D-201). The site-access rule comes from projects/access.ts; a cookie also needs a
// project that names the origin: in `all` mode every origin is allowed for capture, and without
// that a link could make anyone mint a cookie for an arbitrary site. INJECTOR_ORIGINS, when set,
// is a hard allowlist on top.
import type { Db } from '../db/index.ts';
import { env } from '../env.ts';
import { reviewOriginAllowed } from '../projects/access.ts';
import { normalizeOrigin } from './cookie.ts';

export type ReviewAccess = { allowed: true; projectId: string; workspaceId?: string } | { allowed: false; reason: 'not_listed' | 'not_in_project' };

/** Is this origin in INJECTOR_ORIGINS? An empty list names every origin. */
export function injectorOriginListed(origin: string, e = env): boolean {
  return !e.injector.origins.length || e.injector.origins.some((o) => normalizeOrigin(o) === origin);
}

export async function reviewAccess(db: Db, userId: string, origin: string, e = env): Promise<ReviewAccess> {
  if (!injectorOriginListed(origin, e)) return { allowed: false, reason: 'not_listed' };
  const r = await reviewOriginAllowed(db, origin, userId);
  return r.allowed && r.projectId ? { allowed: true, projectId: r.projectId, workspaceId: r.workspaceId } : { allowed: false, reason: 'not_in_project' };
}
