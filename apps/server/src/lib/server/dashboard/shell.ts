// Data the app shell needs on every page: folders and projects for the sidebar, members for the
// header avatars and the creator filter, onboarding state.
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { project, recording } from '../db/schema/index.ts';
import { seatOf, visibleCapturesWhere } from '../share/access.ts';
import type { SeatRole } from '@toolbar/shared/api';
import { listFolders } from './folders.ts';
import { listMembers, onboarding } from './workspace.ts';

export interface ShellProject {
  id: string;
  name: string;
  origins: string[];
  /** captures of the project the viewer can see */
  captureCount: number;
}

/** Projects of the workspace with the captures each holds (D-200: captures grouped by project). */
export async function projectsWithCounts(db: Db, workspaceId: string, userId: string, seat: SeatRole): Promise<ShellProject[]> {
  const rows = await db
    .select({ id: project.id, name: project.name, origins: project.origins })
    .from(project)
    .where(eq(project.organizationId, workspaceId))
    .orderBy(asc(project.name), asc(project.createdAt));
  if (!rows.length) return [];
  const counts = await db
    .select({ id: recording.projectId, n: sql<number>`count(*)::int` })
    .from(recording)
    .where(and(eq(recording.organizationId, workspaceId), visibleCapturesWhere(userId, seat), sql`${recording.projectId} IS NOT NULL`))
    .groupBy(recording.projectId);
  const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
  return rows.map((r) => ({ ...r, captureCount: byId.get(r.id) ?? 0 }));
}

export async function shellData(db: Db, userId: string, workspaceId: string | null) {
  if (!workspaceId) return { folders: [], projects: [] as ShellProject[], members: [], onboarding: null, seat: null };
  const seat = await seatOf(db, userId, workspaceId);
  if (!seat) return { folders: [], projects: [] as ShellProject[], members: [], onboarding: null, seat: null };
  const [folders, projects, members, ob] = await Promise.all([
    listFolders(db, workspaceId, { userId, seat }),
    projectsWithCounts(db, workspaceId, userId, seat),
    listMembers(db, workspaceId),
    onboarding(db, userId, workspaceId),
  ]);
  return { folders, projects, members, onboarding: ob, seat };
}
