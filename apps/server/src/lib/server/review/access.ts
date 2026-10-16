// The one place the injector's server code asks whether a reviewer cookie may be signed for an
// origin (D-200). The project rule comes from the site-access helper (projects/); INJECTOR_ORIGINS,
// when set, is a hard allowlist on top of it.
import type { Db } from '../db/index.ts';
import { env } from '../env.ts';
// Merge note: this import names the stub in this branch; point it at the site-access branch's
// file if it lands under another name.
import { reviewOriginAllowed } from '../projects/review-origin.ts';
import { normalizeOrigin } from './cookie.ts';

export type ReviewAccess = { allowed: true; projectId?: string; workspaceId?: string } | { allowed: false; reason: 'not_listed' | 'not_in_project' };

/** Is this origin in INJECTOR_ORIGINS? An empty list names every origin. */
export function injectorOriginListed(origin: string, e = env): boolean {
  return !e.injector.origins.length || e.injector.origins.some((o) => normalizeOrigin(o) === origin);
}

export async function reviewAccess(db: Db, userId: string, origin: string, e = env): Promise<ReviewAccess> {
  if (!injectorOriginListed(origin, e)) return { allowed: false, reason: 'not_listed' };
  const r = await reviewOriginAllowed(db, origin, userId);
  return r.allowed ? { allowed: true, projectId: r.projectId, workspaceId: r.workspaceId } : { allowed: false, reason: 'not_in_project' };
}
