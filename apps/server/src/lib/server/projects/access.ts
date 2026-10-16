// Site access (D-200): which origins the extension, the submit check and the injector's review
// links accept, and the project an origin belongs to. Two modes, an instance setting
// (`siteAccess`, env SITE_ACCESS):
//
// - `all` (default): every http(s) origin but this server's own is accepted. The first capture on
//   an origin with no project makes one in the capture's workspace (name: the host, origins: that
//   origin, masking preset and trace step window from the workspace's defaults, else the
//   instance's). Admins merge projects to group hostnames and domains.
// - `projects` (strict, D-126): only origins listed in a project; nothing is made automatically.
//
// Matching precedence everywhere: an exact origin before the most specific wildcard domain
// (`@toolbar/shared/projects` projectForUrl). Every origin check on the server goes through this
// module; the injector's review links call `reviewOriginAllowed`, whose signature is stable.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { autoProjectOf, mergeOrigins, pageOrigin, projectForUrl, type SiteAccessMode } from '@toolbar/shared/projects';
import type { Db } from '../db/index.ts';
import { member, project, recording } from '../db/schema/index.ts';
import { env } from '../env.ts';
import { fail } from '../share/http.ts';
import { setting } from '../settings/index.ts';
import { activeWorkspaceId, listWorkspaces } from '../auth/workspaces.ts';
import { projectDefaults } from '../projects.ts';

type Row = typeof project.$inferSelect;

/** The instance's site access mode: SITE_ACCESS, else Settings > Server, else `all`. */
export function siteAccessMode(): SiteAccessMode {
  return setting('siteAccess') === 'projects' ? 'projects' : 'all';
}

/** Whether `url` is a page of this server (J-019): never captured, never a project. */
export function isServerUrl(url: string | null | undefined): boolean {
  const o = pageOrigin(url);
  return !!o && o === pageOrigin(env.publicUrl);
}

/** Projects of the given workspaces, oldest first (the tie-break of projectForUrl). */
async function projectsIn(db: Db, workspaceIds: string[]): Promise<Row[]> {
  if (!workspaceIds.length) return [];
  return db.select().from(project).where(inArray(project.organizationId, workspaceIds)).orderBy(asc(project.createdAt), asc(project.id));
}

export interface OriginAccess {
  allowed: boolean;
  /** the project whose origins cover this origin, when one does */
  projectId?: string;
  /** the project's workspace; in `all` mode without a project, the user's active workspace */
  workspaceId?: string;
}

/**
 * May `userId` capture (or review through the injector) on `origin`, and under which project?
 *
 * - `origin` is a page origin (`https://staging.nuru.sh`, `http://localhost:5173`) or any URL on
 *   it; a path is ignored. Anything but http(s), a wildcard, or this server's own origin is
 *   refused.
 * - A project of one of the user's workspaces that covers the origin (exact origin first, then
 *   the most specific wildcard; on a tie the active workspace, then the oldest project) gives
 *   `{ allowed: true, projectId, workspaceId }`, in either mode.
 * - Otherwise `all` mode gives `{ allowed: true, workspaceId: <active workspace> }` (the first
 *   capture there makes the project), and `projects` mode `{ allowed: false }`.
 * - A user in no workspace is refused.
 *
 * Never throws for a bad origin; reads the database only.
 */
export async function reviewOriginAllowed(db: Db, origin: string | null | undefined, userId: string): Promise<OriginAccess> {
  const o = pageOrigin(origin);
  if (!o || !userId || isServerUrl(o)) return { allowed: false };
  const workspaces = await listWorkspaces(db, userId);
  if (!workspaces.length) return { allowed: false };
  const active = await activeWorkspaceId(db, userId, workspaces);
  const rows = await projectsIn(db, workspaces.map((w) => w.id));
  // the active workspace first, so it wins a tie of equally specific origins
  const ordered = [...rows.filter((r) => r.organizationId === active), ...rows.filter((r) => r.organizationId !== active)];
  const hit = projectForUrl(ordered, `${o}/`);
  if (hit) return { allowed: true, projectId: hit.id, workspaceId: hit.organizationId };
  if (siteAccessMode() === 'projects') return { allowed: false };
  return { allowed: true, workspaceId: active ?? workspaces[0]!.id };
}

/**
 * The project of a capture submitted to `workspaceId` (D-124, D-200). Returns null for captures
 * that belong to no project: desktop recordings (kind `screen`) and pages that are not http(s) or
 * are this server's own (J-019), unless a project covers their page anyway.
 *
 * - A project of the workspace covers the page: that project.
 * - `all` mode: a new project for the page's origin, made once per origin and workspace (a
 *   transaction-scoped advisory lock keeps two first captures from making two projects).
 * - `projects` mode: 403 `origin_not_allowed`; a workspace with no project at all is exempt, as
 *   D-124 had it.
 */
export async function projectForCapture(
  db: Db,
  workspaceId: string,
  input: { pageUrl: string | null | undefined; kind: string; userId: string | null },
): Promise<Row | null> {
  const rows = await projectsIn(db, [workspaceId]);
  const url = input.pageUrl ?? '';
  const match = projectForUrl(rows, url);
  if (match) return match;
  const origin = pageOrigin(url);
  if (input.kind === 'screen' || !origin || isServerUrl(url)) return null;
  if (siteAccessMode() === 'projects') {
    if (!rows.length) return null;
    fail('origin_not_allowed', `${origin} is not an origin of any project in this workspace. A workspace admin can add it under Settings, Projects.`);
  }
  return autoCreateProject(db, workspaceId, url, input.userId);
}

/** `all` mode: make the project for a page's origin, or return the one a concurrent capture just made. */
export async function autoCreateProject(db: Db, workspaceId: string, url: string, userId: string | null): Promise<Row | null> {
  const auto = autoProjectOf(url);
  if (!auto) return null;
  const defaults = await projectDefaults(db, workspaceId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`project-auto:${workspaceId}:${auto.origins[0]}`}, 0))`);
    const rows = await tx.select().from(project).where(eq(project.organizationId, workspaceId)).orderBy(asc(project.createdAt), asc(project.id));
    const again = projectForUrl(rows, url);
    if (again) return again;
    const [r] = await tx
      .insert(project)
      .values({ organizationId: workspaceId, createdBy: userId, name: auto.name, origins: auto.origins, bodyAllowlist: [], ...defaults })
      .returning();
    return r!;
  });
}

/**
 * Merge project `fromId` into `intoId` (D-200): both must be in one workspace; `into` gains the
 * origins it does not list yet and every capture of `from`, and `from` is removed. Its masking
 * preset, allowlist and step window are dropped: `into` keeps its own.
 */
export async function mergeProjects(db: Db, intoId: string, fromId: string): Promise<{ project: Row; movedCaptures: number }> {
  if (intoId === fromId) fail('invalid_body', 'Pick another project to merge');
  return db.transaction(async (tx) => {
    const both = await tx.select().from(project).where(inArray(project.id, [intoId, fromId])).for('update');
    const into = both.find((r) => r.id === intoId);
    const from = both.find((r) => r.id === fromId);
    if (!into || !from) fail('not_found', 'No such project');
    if (into.organizationId !== from.organizationId) fail('invalid_body', 'The projects are in different workspaces');
    let origins: string[];
    try {
      origins = mergeOrigins(into.origins, from.origins);
    } catch (e) {
      fail('invalid_body', (e as Error).message);
    }
    const moved = await tx.update(recording).set({ projectId: into.id }).where(eq(recording.projectId, from.id)).returning({ id: recording.id });
    await tx.delete(project).where(eq(project.id, from.id));
    const [r] = await tx.update(project).set({ origins, updatedAt: new Date() }).where(eq(project.id, into.id)).returning();
    return { project: r!, movedCaptures: moved.length };
  });
}

/** The site access block of the extension bootstrap: the mode and the new-project defaults of each of the user's workspaces. */
export async function siteAccessOf(db: Db, userId: string) {
  const ws = await db.select({ id: member.organizationId }).from(member).where(and(eq(member.userId, userId)));
  const defaults = await Promise.all(ws.map(async (w) => ({ workspaceId: w.id, ...(await projectDefaults(db, w.id)) })));
  return { mode: siteAccessMode(), defaults };
}
