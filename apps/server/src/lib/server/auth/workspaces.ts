// Workspaces (Better Auth organizations): membership, seat roles, settings, the active workspace,
// creation and join by email domain (X-06, J-124, J-125, J-168, J-221). Owner: auth area.
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@toolbar/shared';
import { roleAtLeast, seatRoleOf, workspaceSettingsSchema, type SeatRole, type Workspace, type WorkspaceSettings } from '@toolbar/shared/api';
import { DEFAULT_WORKSPACE_SETTINGS, joinableDomain } from '@toolbar/shared/areas/auth';
import type { Db } from '../db/index.ts';
import { member, organization, user } from '../db/schema/index.ts';
import { sendMail } from '../mail.ts';
import { emailAllowed } from '../dashboard/core.ts';
import { env } from '../env.ts';
import { currentBrand } from '../branding/index.ts';

export type StoredSettings = Omit<WorkspaceSettings, 'name' | 'logoUrl'>;

/** Stored settings with defaults filled in; unknown or invalid keys fall back to the default. */
export function readSettings(raw: unknown): StoredSettings {
  const shape = workspaceSettingsSchema.omit({ name: true, logoUrl: true }).shape;
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_WORKSPACE_SETTINGS };
  // Key by key, so one bad value falls back alone instead of resetting everything.
  for (const [k, schema] of Object.entries(shape)) {
    if (!(k in src)) continue;
    const r = schema.safeParse(src[k]);
    if (r.success) out[k] = r.data;
  }
  return out as StoredSettings;
}

export async function getSettings(db: Db, workspaceId: string): Promise<StoredSettings | null> {
  const [row] = await db.select({ settings: organization.settings }).from(organization).where(eq(organization.id, workspaceId));
  return row ? readSettings(row.settings) : null;
}

/** Merge a partial settings object into the stored one (dashboard's PATCH can call this too). */
export async function patchSettings(db: Db, workspaceId: string, patch: Partial<StoredSettings>): Promise<StoredSettings> {
  const cur = (await getSettings(db, workspaceId)) ?? DEFAULT_WORKSPACE_SETTINGS;
  const next = { ...cur, ...patch };
  await db.update(organization).set({ settings: next }).where(eq(organization.id, workspaceId));
  return next;
}

/** The caller's stored role in a workspace, or null when not a member. */
export async function memberRow(db: Db, userId: string, workspaceId: string) {
  const [row] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, workspaceId)));
  return row ?? null;
}

export async function seatRole(db: Db, userId: string, workspaceId: string): Promise<SeatRole | null> {
  const row = await memberRow(db, userId, workspaceId);
  return row ? seatRoleOf(row.role) : null;
}

export async function hasRole(db: Db, userId: string, workspaceId: string, need: SeatRole): Promise<boolean> {
  const r = await seatRole(db, userId, workspaceId);
  return r !== null && roleAtLeast(r, need);
}

/**
 * Before a capture is created (J-124, J-222): creators and admins pass; a viewer is upgraded to
 * creator when the workspace auto-approves creators, otherwise refused. Returns the seat after.
 */
export async function ensureCanCreate(db: Db, userId: string, workspaceId: string): Promise<SeatRole | null> {
  const row = await memberRow(db, userId, workspaceId);
  if (!row) return null;
  const seat = seatRoleOf(row.role);
  if (seat !== 'viewer') return seat;
  const s = await getSettings(db, workspaceId);
  if (!s?.autoApproveCreators) return 'viewer';
  await db.update(member).set({ role: 'creator' }).where(eq(member.id, row.id));
  return 'creator';
}

/** Workspaces of a user with the caller's seat and member counts, oldest first. */
export async function listWorkspaces(db: Db, userId: string): Promise<Workspace[]> {
  const rows = await db
    .select({ org: organization, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.createdAt));
  if (!rows.length) return [];
  const counts = await db
    .select({ id: member.organizationId, n: count() })
    .from(member)
    .where(inArray(member.organizationId, rows.map((r) => r.org.id)))
    .groupBy(member.organizationId);
  const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
  return rows.map(({ org, role }) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    logoUrl: org.logo ?? null,
    role: seatRoleOf(role),
    isOwner: role === 'owner',
    memberCount: byId.get(org.id) ?? 1,
    createdAt: org.createdAt.toISOString(),
  }));
}

/**
 * The workspace a user acts in: the stored choice when still a member, else their first owned
 * workspace, else the first one. Persists a repaired choice. Null when the user has none.
 */
export async function activeWorkspaceId(db: Db, userId: string, list?: Workspace[]): Promise<string | null> {
  const ws = list ?? (await listWorkspaces(db, userId));
  const [u] = await db.select({ active: user.activeWorkspaceId }).from(user).where(eq(user.id, userId));
  if (u?.active && ws.some((w) => w.id === u.active)) return u.active;
  const pick = ws.find((w) => w.isOwner) ?? ws[0];
  if (!pick) return null;
  await db.update(user).set({ activeWorkspaceId: pick.id }).where(eq(user.id, userId));
  return pick.id;
}

export async function setActiveWorkspace(db: Db, userId: string, workspaceId: string): Promise<boolean> {
  if (!(await memberRow(db, userId, workspaceId))) return false;
  await db.update(user).set({ activeWorkspaceId: workspaceId }).where(eq(user.id, userId));
  return true;
}

const slugFor = (id: string) => `w-${id.replace(/-/g, '').slice(-12)}`;

/**
 * Create a workspace with the user as owner and make it active (J-221). `domainJoin` turns on
 * join-by-domain for the creator's email domain when that is not a webmail domain (J-125).
 */
export async function createWorkspace(
  db: Db,
  opts: { userId: string; email: string; name: string; domainJoin: boolean },
): Promise<Workspace> {
  const id = uuidv7();
  const domain = joinableDomain(opts.email);
  const settings: StoredSettings = {
    ...DEFAULT_WORKSPACE_SETTINGS,
    domainJoin: { enabled: opts.domainJoin && domain !== null, domain: opts.domainJoin ? domain : null },
  };
  const [org] = await db.insert(organization).values({ id, name: opts.name, slug: slugFor(id), settings }).returning();
  await db.insert(member).values({ organizationId: id, userId: opts.userId, role: 'owner' });
  await db.update(user).set({ activeWorkspaceId: id }).where(eq(user.id, opts.userId));
  return {
    id,
    name: org!.name,
    slug: org!.slug,
    logoUrl: null,
    role: 'admin',
    isOwner: true,
    memberCount: 1,
    createdAt: org!.createdAt.toISOString(),
  };
}

/** Add a member (no-op when already one; never downgrades). Returns the seat they hold. */
export async function addMember(db: Db, workspaceId: string, userId: string, role: 'creator' | 'viewer' | 'admin'): Promise<SeatRole> {
  const existing = await memberRow(db, userId, workspaceId);
  if (existing) return seatRoleOf(existing.role);
  await db.insert(member).values({ organizationId: workspaceId, userId, role }).onConflictDoNothing();
  return role;
}

/** Workspaces whose domain join matches this address (J-125). */
export async function domainJoinWorkspaces(db: Db, email: string) {
  const domain = joinableDomain(email);
  if (!domain) return [];
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(
      and(
        sql`${organization.settings} -> 'domainJoin' ->> 'enabled' = 'true'`,
        sql`lower(${organization.settings} -> 'domainJoin' ->> 'domain') = ${domain}`,
      ),
    );
}

async function adminEmails(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, workspaceId), inArray(member.role, ['owner', 'admin'])));
  // J-136: admins who turned off the same-domain sign-up email do not get it
  const out: string[] = [];
  for (const r of rows) if (await emailAllowed(db, r.id, 'domainSignup')) out.push(r.email);
  return out;
}

/**
 * Join every workspace whose domain join matches a verified address, as a viewer (J-125), and
 * email that workspace's admins. Workspaces the user is already in are left alone.
 */
export async function joinByDomain(db: Db, u: { id: string; email: string; name: string; emailVerified: boolean }): Promise<string[]> {
  if (!u.emailVerified) return [];
  const joined: string[] = [];
  for (const w of await domainJoinWorkspaces(db, u.email)) {
    if (await memberRow(db, u.id, w.id)) continue;
    await addMember(db, w.id, u.id, 'viewer');
    joined.push(w.id);
    const to = await adminEmails(db, w.id);
    const who = u.name && u.name !== u.email ? `${u.name} (${u.email})` : u.email;
    await Promise.all(
      to.map((addr) =>
        sendMail(
          addr,
          `${who} joined ${w.name}`,
          `${who} signed up with your email domain and joined ${w.name} on ${currentBrand().name} as a viewer.\n\n` +
            `Change their seat on the members page: ${env.publicUrl}/settings/members`,
        ).catch((e: unknown) => console.warn('[auth] domain-join mail failed', e)),
      ),
    );
  }
  return joined;
}

/**
 * First sign-in (X-06, J-125): join by email domain when it matches, otherwise get a personal
 * workspace as owner. Either way the user ends with an active workspace.
 */
export async function bootstrapNewUser(db: Db, u: { id: string; email: string; name: string; emailVerified: boolean }) {
  const joined = await joinByDomain(db, u);
  if (joined.length) {
    await db.update(user).set({ activeWorkspaceId: joined[0]! }).where(eq(user.id, u.id));
    return { joined, created: null };
  }
  const base = (u.name || u.email).split('@')[0]!;
  const ws = await createWorkspace(db, { userId: u.id, email: u.email, name: `${base}'s workspace`, domainJoin: false });
  return { joined: [], created: ws.id };
}
