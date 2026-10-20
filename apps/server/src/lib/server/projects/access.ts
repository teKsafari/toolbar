// Site access (D-200, D-203): which origins the extension, the submit check and the embed (D-211)
// accept, and the project an origin belongs to. Two modes, an instance setting
// (`siteAccess`, env SITE_ACCESS):
//
// - `projects` (default, D-203): only origins listed in a project; nothing is made automatically.
//   Members add a site from the extension icon (addSite below).
// - `all` (opt-in): every http(s) origin but this server's own is accepted. The first capture on
//   an origin with no project makes one in the capture's workspace (name: the host, origins: that
//   origin, masking preset and trace step window from the workspace's defaults, else the
//   instance's). Admins merge projects to group hostnames and domains.
//
// Matching precedence everywhere: an exact origin before the most specific wildcard domain
// (`@toolbar/shared/projects` projectForUrl). Every origin check on the server goes through this
// module.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { autoProjectOf, LIMITS_PROJECT, mergeOrigins, pageOrigin, projectForUrl, type SiteAccessMode } from '@toolbar/shared/projects';
import type { Db } from '../db/index.ts';
import { member, project, recording } from '../db/schema/index.ts';
import { env } from '../env.ts';
import { fail } from '../share/http.ts';
import { setting } from '../settings/index.ts';
import { getSettings, seatRole } from '../auth/workspaces.ts';
import { projectDefaults } from '../projects.ts';

type Row = typeof project.$inferSelect;

/** The instance's site access mode: SITE_ACCESS, else Settings > Server, else `projects` (D-203). */
export function siteAccessMode(): SiteAccessMode {
  return setting('siteAccess') === 'all' ? 'all' : 'projects';
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

/** May `userId` add a site to a project of `workspaceId` (D-205): admins, or any member unless the workspace restricts it. */
export async function canAddSites(db: Db, userId: string, workspaceId: string): Promise<boolean> {
  const seat = await seatRole(db, userId, workspaceId);
  if (!seat) return false;
  if (seat === 'admin') return true;
  return !(await getSettings(db, workspaceId))?.restrictSiteAdds;
}

/**
 * Add a page's origin to a project, or to a new project named after the host (D-205). The caller
 * checked canAddSites. Refuses this server's own origin, anything but http(s), and a project of
 * another workspace. An origin a project of the workspace already covers is returned as is.
 * Records who added the origin, so they may remove it again.
 */
export async function addSite(db: Db, workspaceId: string, userId: string, input: { origin: string; projectId?: string }): Promise<{ project: Row; created: boolean }> {
  const origin = pageOrigin(input.origin);
  if (!origin) fail('invalid_body', 'Not a web page');
  if (isServerUrl(origin)) fail('invalid_body', 'This is your server');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`project-auto:${workspaceId}:${origin}`}, 0))`);
    const rows = await tx.select().from(project).where(eq(project.organizationId, workspaceId)).orderBy(asc(project.createdAt), asc(project.id));
    if (input.projectId) {
      const p = rows.find((r) => r.id === input.projectId);
      if (!p) fail('not_found', 'No such project');
      if (p.origins.includes(origin)) return { project: p, created: false };
      if (p.origins.length >= LIMITS_PROJECT.origins) fail('invalid_body', `A project holds at most ${LIMITS_PROJECT.origins} origins`);
      const [r] = await tx
        .update(project)
        .set({ origins: [...p.origins, origin], originAddedBy: { ...p.originAddedBy, [origin]: userId }, updatedAt: new Date() })
        .where(eq(project.id, p.id))
        .returning();
      return { project: r!, created: false };
    }
    const auto = autoProjectOf(origin)!;
    const same = rows.find((r) => r.origins.includes(origin));
    if (same) return { project: same, created: false };
    const defaults = await projectDefaults(db, workspaceId);
    const [r] = await tx
      .insert(project)
      .values({ organizationId: workspaceId, createdBy: userId, name: auto.name, origins: auto.origins, originAddedBy: { [origin]: userId }, bodyAllowlist: [], ...defaults })
      .returning();
    return { project: r!, created: true };
  });
}

/**
 * Remove one exact origin from a project (D-205): workspace admins, or the member who added it.
 * The project goes with its last origin; its captures stay, without a project.
 */
export async function removeSite(db: Db, projectId: string, userId: string, rawOrigin: string): Promise<Row | null> {
  const origin = pageOrigin(rawOrigin) ?? rawOrigin;
  const [p] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  if (!p) fail('not_found', 'No such project');
  const seat = await seatRole(db, userId, p.organizationId);
  if (!seat) fail('not_found', 'No such project');
  if (!p.origins.includes(origin)) fail('invalid_body', `${origin} is not an origin of ${p.name}`);
  if (seat !== 'admin' && p.originAddedBy[origin] !== userId) fail('forbidden', 'Only a workspace admin or the person who added this site can remove it');
  const origins = p.origins.filter((o) => o !== origin);
  if (!origins.length) {
    await db.delete(project).where(eq(project.id, p.id));
    return null;
  }
  const by = { ...p.originAddedBy };
  delete by[origin];
  const [r] = await db.update(project).set({ origins, originAddedBy: by, updatedAt: new Date() }).where(eq(project.id, p.id)).returning();
  return r!;
}

/** The site access block of the extension bootstrap: the mode, the new-project defaults of each of the user's workspaces, and where they may add a site. */
export async function siteAccessOf(db: Db, userId: string) {
  const ws = await db.select({ id: member.organizationId }).from(member).where(and(eq(member.userId, userId)));
  const defaults = await Promise.all(ws.map(async (w) => ({ workspaceId: w.id, ...(await projectDefaults(db, w.id)) })));
  const can = await Promise.all(ws.map((w) => canAddSites(db, userId, w.id)));
  return { mode: siteAccessMode(), defaults, canAdd: ws.filter((_, i) => can[i]).map((w) => w.id) };
}
