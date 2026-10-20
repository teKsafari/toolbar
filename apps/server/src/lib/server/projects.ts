// Projects (D-123 to D-127): CRUD for the dashboard and API, the extension's bootstrap list, and
// the origin check every capture passes on submit.
import { asc, eq, inArray } from 'drizzle-orm';
import type { Project } from '@toolbar/shared/api';
import { TRACE_OPEN_MS, traceOpenMsOf, type ProjectScope } from '@toolbar/shared/projects';
import type { Db } from './db/index.ts';
import { member, project } from './db/schema/index.ts';
import { fail } from './share/http.ts';
import { setting } from './settings/index.ts';
import { getSettings } from './auth/workspaces.ts';

type Row = typeof project.$inferSelect;

export function projectDto(r: Row): Project {
  return {
    id: r.id,
    workspaceId: r.organizationId,
    name: r.name,
    origins: r.origins,
    maskingPreset: r.maskingPreset,
    bodyAllowlist: r.bodyAllowlist,
    traceOpenMs: r.traceOpenMs,
    embedKey: r.embedKey,
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
  traceOpenMs: r.traceOpenMs,
});

export async function listProjects(db: Db, workspaceId: string): Promise<Row[]> {
  return db.select().from(project).where(eq(project.organizationId, workspaceId)).orderBy(asc(project.name), asc(project.createdAt));
}

/** Projects of every workspace the user is a member of (the extension's bootstrap). */
export async function projectsOfUser(db: Db, userId: string): Promise<ProjectScope[]> {
  const ws = db.select({ id: member.organizationId }).from(member).where(eq(member.userId, userId));
  const rows = await db.select().from(project).where(inArray(project.organizationId, ws)).orderBy(asc(project.createdAt));
  // D-205: the origins this user added from the extension, which they may remove
  return rows.map((r) => {
    const mine = Object.entries(r.originAddedBy ?? {})
      .filter(([o, by]) => by === userId && r.origins.includes(o))
      .map(([o]) => o);
    return mine.length ? { ...scopeOf(r), mine } : scopeOf(r);
  });
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
  traceOpenMs?: number;
}

/**
 * The span engine settings of a capture (D-166): its project's window for open requests, or the
 * default when the capture has no project.
 */
export async function traceConfigOf(db: Db, rec: { projectId: string | null }): Promise<{ maxOpenMs: number }> {
  if (!rec.projectId) return { maxOpenMs: TRACE_OPEN_MS.default };
  const [r] = await db.select({ v: project.traceOpenMs }).from(project).where(eq(project.id, rec.projectId)).limit(1);
  return { maxOpenMs: traceOpenMsOf(r ? { traceOpenMs: r.v } : null) };
}

/**
 * Masking preset and trace step window of a new project (D-194): the workspace's defaults
 * (Settings, General), else the instance's (Settings > Server, Capture defaults).
 */
export async function projectDefaults(db: Db, workspaceId: string | null): Promise<{ maskingPreset: Row['maskingPreset']; traceOpenMs: number }> {
  const ws = workspaceId ? await getSettings(db, workspaceId) : null;
  return {
    maskingPreset: ws?.defaultMaskingPreset ?? setting('defaultMaskingPreset') ?? 'staging',
    traceOpenMs: traceOpenMsOf({ traceOpenMs: ws?.defaultTraceOpenMs ?? setting('defaultTraceOpenMs') ?? TRACE_OPEN_MS.default }),
  };
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

// The origin check on submit, projects made by a first capture, merging and the embed's origin
// check live in ./projects/access.ts (D-200, D-211).
