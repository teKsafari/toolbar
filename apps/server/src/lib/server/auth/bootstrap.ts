// One payload for the extension popup and in-page editor (J-001 budget, J-080, J-081, J-215).
// Folders and integrations are read straight from the dashboard area's tables; when that area
// lands its own list helpers (folder shortId, integration status) this file should call them.
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { LIMITS } from '@toolbar/shared';
import { BUILT_INTEGRATIONS, DEFAULT_USER_SETTINGS, type ExtBootstrap, type Folder, type Integration } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { folder, integration, recording, user } from '../db/schema/index.ts';
import { activeWorkspaceId, listWorkspaces } from './workspaces.ts';
import { supportLinkUrl } from '../dashboard/links.ts';
import { env } from '../env.ts';
import { projectsOfUser } from '../projects.ts';
import { brandingDto, getBrand } from '../branding/index.ts';
import { setting } from '../settings/index.ts';

type Person = { id: string; name: string; email: string; image: string | null };

async function foldersOf(db: Db, workspaceId: string): Promise<Folder[]> {
  const rows = await db
    .select({ f: folder, by: { id: user.id, name: user.name, email: user.email, image: user.image } })
    .from(folder)
    .leftJoin(user, eq(user.id, folder.createdBy))
    .where(eq(folder.organizationId, workspaceId))
    .orderBy(asc(folder.name));
  if (!rows.length) return [];
  const counts = await db
    .select({ id: recording.folderId, n: count() })
    .from(recording)
    .where(and(inArray(recording.folderId, rows.map((r) => r.f.id)), isNull(recording.deletedAt)))
    .groupBy(recording.folderId);
  const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
  return rows.map(({ f, by }) => ({
    id: f.id,
    // Provisional: the dashboard area owns the real 4-character folder id (J-162).
    shortId: f.id.replace(/-/g, '').slice(-4),
    workspaceId: f.organizationId,
    name: f.name,
    parentId: f.parentId ?? null,
    private: false,
    captureCount: byId.get(f.id) ?? 0,
    createdBy: by as Person | null,
    createdAt: f.createdAt.toISOString(),
  }));
}

async function integrationsOf(db: Db, workspaceId: string): Promise<Integration[]> {
  const rows = await db
    .select({ i: integration, by: { id: user.id, name: user.name, email: user.email, image: user.image } })
    .from(integration)
    .leftJoin(user, eq(user.id, integration.createdBy))
    .where(eq(integration.organizationId, workspaceId));
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return rows
    .filter(({ i }) => (BUILT_INTEGRATIONS as readonly string[]).includes(i.type))
    .map(({ i, by }) => {
      const c = (i.config ?? {}) as Record<string, unknown>;
      return {
        id: i.id,
        workspaceId: i.organizationId,
        type: i.type as Integration['type'],
        name: str(c.name) ?? i.type,
        account: str(c.account),
        baseUrl: str(c.baseUrl),
        defaultTarget: str(c.defaultTarget),
        status: c.lastError ? ('error' as const) : ('ok' as const),
        lastError: str(c.lastError),
        createdBy: by as Person | null,
        createdAt: i.createdAt.toISOString(),
      };
    });
}

export async function extBootstrap(db: Db, me: Person, opts: { workspaceId?: string; serverVersion: string }): Promise<ExtBootstrap> {
  const workspaces = await listWorkspaces(db, me.id);
  const stored = await activeWorkspaceId(db, me.id, workspaces);
  const active = opts.workspaceId && workspaces.some((w) => w.id === opts.workspaceId) ? opts.workspaceId : stored;
  const maxMin = setting('maxRecordingMin') ?? 0;
  // AI is paused unless FEATURE_AI is on (D-084): the editor then hides its AI switch
  const aiFeature = env.features.ai;
  const ai = aiFeature ? (process.env.AI_PROVIDER ?? 'none') : 'none';
  return {
    user: me,
    workspaces,
    activeWorkspaceId: active,
    folders: active ? await foldersOf(db, active) : [],
    // paused trackers and Slack (D-114): the editor gets no destinations unless their flag is on
    integrations: active
      ? (await integrationsOf(db, active)).filter((i) => (i.type === 'slack' ? env.features.slack : env.features.trackers))
      : [],
    // Per-user settings storage belongs to the dashboard area (GET /api/v1/me/settings); defaults until then.
    settings: DEFAULT_USER_SETTINGS,
    limits: { chunkBytes: LIMITS.chunkBytes, maxRecordingMs: maxMin > 0 ? maxMin * 60_000 : null, aiAvailable: ai !== 'none' && ai !== '' },
    serverVersion: opts.serverVersion,
    features: { ai: aiFeature, trackers: env.features.trackers, slack: env.features.slack },
    // J-177: the menu's "report a problem" opens a recording link to the server admin
    supportRecordingLink: await supportLinkUrl(db).catch(() => null),
    branding: brandingDto(await getBrand(db)),
    // D-123: the extension runs only on these origins
    projects: await projectsOfUser(db, me.id),
  };
}
