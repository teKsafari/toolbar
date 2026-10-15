// Projects (D-123 to D-127): CRUD for the dashboard and API, the extension's bootstrap list, and
// the origin check every capture passes on submit.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Project } from '@toolbar/shared/api';
import { projectForUrl, type ProjectScope } from '@toolbar/shared/projects';
import type { Db } from './db/index.ts';
import { member, project } from './db/schema/index.ts';
import { fail } from './share/http.ts';
import { env } from './env.ts';

type Row = typeof project.$inferSelect;

export function projectDto(r: Row): Project {
  return {
    id: r.id,
    workspaceId: r.organizationId,
    name: r.name,
    origins: r.origins,
    maskingPreset: r.maskingPreset,
    bodyAllowlist: r.bodyAllowlist,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const scopeOf = (r: Row): ProjectScope => ({
  id: r.id,
  workspaceId: r.organizationId,
  name: r.name,
  origins: r.origins,
  maskingPreset: r.maskingPreset,
  bodyAllowlist: r.bodyAllowlist,
});

export async function listProjects(db: Db, workspaceId: string): Promise<Row[]> {
  return db.select().from(project).where(eq(project.organizationId, workspaceId)).orderBy(asc(project.name), asc(project.createdAt));
}

/** Projects of every workspace the user is a member of (the extension's bootstrap). */
export async function projectsOfUser(db: Db, userId: string): Promise<ProjectScope[]> {
  const ws = db.select({ id: member.organizationId }).from(member).where(eq(member.userId, userId));
  const rows = await db.select().from(project).where(inArray(project.organizationId, ws)).orderBy(asc(project.createdAt));
  return rows.map(scopeOf);
}

export async function projectById(db: Db, id: string): Promise<Row> {
  const [r] = await db.select().from(project).where(eq(project.id, id)).limit(1);
  if (!r) fail('not_found', 'No such project');
  return r;
}

export interface ProjectInput {
  name: string;
  origins: string[];
  maskingPreset: Row['maskingPreset'];
  bodyAllowlist: string[];
}

export async function createProject(db: Db, workspaceId: string, userId: string, input: ProjectInput): Promise<Row> {
  const [r] = await db
    .insert(project)
    .values({ organizationId: workspaceId, createdBy: userId, ...input })
    .returning();
  return r!;
}

export async function updateProject(db: Db, id: string, patch: Partial<ProjectInput>): Promise<Row> {
  const [r] = await db.update(project).set({ ...patch, updatedAt: new Date() }).where(eq(project.id, id)).returning();
  if (!r) fail('not_found', 'No such project');
  return r;
}

export async function deleteProject(db: Db, id: string): Promise<void> {
  await db.delete(project).where(eq(project.id, id));
}

/**
 * The allowlist check on submit (PLAN "Zero integration", D-124). A capture of a web page must
 * come from an origin of one of the workspace's projects. Exempt: a workspace with no project
 * yet (nothing to check against, and the extension captures nowhere there), desktop recordings
 * (kind `screen`: the whole screen, no page hooks), pages of this server itself (J-019), and
 * captures without an http(s) page.
 */
export async function projectForCapture(
  db: Db,
  workspaceId: string,
  input: { pageUrl: string | null | undefined; kind: string },
): Promise<Row | null> {
  const rows = await db.select().from(project).where(and(eq(project.organizationId, workspaceId)));
  if (!rows.length) return null;
  const url = input.pageUrl ?? '';
  const match = projectForUrl(rows, url);
  if (match) return match;
  if (input.kind === 'screen' || !/^https?:\/\//i.test(url) || sameOrigin(url, env.publicUrl)) return null;
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    /* keep */
  }
  fail('origin_not_allowed', `${origin} is not an origin of any project in this workspace. A workspace admin can add it under Settings, Projects.`);
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
