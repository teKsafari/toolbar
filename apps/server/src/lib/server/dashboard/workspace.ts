// Workspace settings (J-120, J-156, J-172, J-178), members and seats (J-173, J-222, J-249),
// profile and account deletion (J-175, J-225), onboarding (J-169).
import { and, asc, count, desc, eq, inArray, isNull, lt, max, ne, sql } from 'drizzle-orm';
import { seatRoleOf, type Member, type SeatRole, type WorkspaceSettings } from '@toolbar/shared/api';
import { onboardingSteps } from '@toolbar/shared/areas/dashboard';
import { env } from '../env.ts';
import type { Db } from '../db/index.ts';
import {
  apiToken,
  asset,
  auditLog,
  comment,
  integration,
  member,
  organization,
  recording,
  session,
  user,
  userSettings,
  webhook,
} from '../db/schema/index.ts';
import { getSettings, listWorkspaces, patchSettings, type StoredSettings } from '../auth/workspaces.ts';
import { fail } from '../share/http.ts';
import { purgeMedia, assetUrl } from '../upload/service.ts';
import { sendMail } from '../mail.ts';
import { accountDeletedMail } from '../mail-templates/index.ts';
import { audit, iso, patchRawSettings, personOf, settingsRow } from './core.ts';
import { currentBrand } from '../branding/index.ts';

// ---------- workspace ----------

export async function workspaceDetail(db: Db, workspaceId: string, userId: string) {
  const ws = (await listWorkspaces(db, userId)).find((w) => w.id === workspaceId);
  if (!ws) fail('not_found', 'No such workspace');
  const s = (await getSettings(db, workspaceId))!;
  const settings: WorkspaceSettings = { name: ws.name, logoUrl: ws.logoUrl, ...s };
  return { ...ws, settings };
}

export async function updateWorkspace(
  db: Db,
  workspaceId: string,
  actorId: string,
  body: Partial<Omit<StoredSettings, never>> & { name?: string; logoAssetId?: string | null },
) {
  const { name, logoAssetId, ...rest } = body as Record<string, unknown> & { name?: string; logoAssetId?: string | null };
  const orgSet: Record<string, unknown> = {};
  if (name !== undefined) orgSet.name = name;
  if (logoAssetId !== undefined) {
    if (logoAssetId === null) orgSet.logo = null;
    else {
      const [a] = await db.select().from(asset).where(eq(asset.id, logoAssetId));
      if (!a || (a.createdBy && a.createdBy !== actorId)) fail('invalid_body', 'Logo upload not found');
      orgSet.logo = assetUrl(a);
    }
  }
  const settingKeys = Object.keys(rest).filter((k) => rest[k] !== undefined);
  let stored = await getSettings(db, workspaceId);
  if (settingKeys.length) {
    stored = await patchSettings(db, workspaceId, Object.fromEntries(settingKeys.map((k) => [k, rest[k]])) as Partial<StoredSettings>);
  }
  // server-core reads the default link access from organization.metadata (upload/service.ts defaultAccessOf).
  const [o] = await db.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, workspaceId));
  let meta: Record<string, unknown> = {};
  try {
    meta = o?.metadata ? JSON.parse(o.metadata) : {};
  } catch {
    meta = {};
  }
  meta.defaultLinkAccess = stored!.defaultLinkAccess;
  orgSet.metadata = JSON.stringify(meta);
  await db.update(organization).set(orgSet).where(eq(organization.id, workspaceId));
  if (Object.keys(body).length)
    await audit(db, { workspaceId, actorId, action: 'workspace.updated', target: { type: 'workspace', id: workspaceId, label: name ?? null }, details: { fields: Object.keys(body) } });
  return workspaceDetail(db, workspaceId, actorId);
}

/** Delete a workspace with every capture and its media (J-249). */
export async function eraseWorkspace(db: Db, workspaceId: string) {
  const recs = await db.select({ id: recording.id }).from(recording).where(eq(recording.organizationId, workspaceId));
  for (const r of recs) {
    try {
      await purgeMedia(db, r.id);
    } catch (e) {
      console.warn('[dashboard] purge failed for', r.id, e);
    }
  }
  await db.update(user).set({ activeWorkspaceId: null }).where(eq(user.activeWorkspaceId, workspaceId));
  await db.delete(organization).where(eq(organization.id, workspaceId));
}

// ---------- members ----------

export async function listMembers(db: Db, workspaceId: string, q?: string): Promise<Member[]> {
  const rows = await db
    .select({ m: member, u: { id: user.id, name: user.name, email: user.email, image: user.image } })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        q?.trim() ? sql`(${user.name} ILIKE ${'%' + q.trim() + '%'} OR ${user.email} ILIKE ${'%' + q.trim() + '%'})` : undefined,
      ),
    )
    .orderBy(asc(member.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.u.id);
  const last = await db
    .select({ id: session.userId, at: max(session.updatedAt) })
    .from(session)
    .where(inArray(session.userId, ids))
    .groupBy(session.userId);
  const lastBy = new Map(last.map((l) => [l.id, l.at]));
  return rows.map(({ m, u }) => ({
    userId: u.id,
    person: personOf(u)!,
    role: seatRoleOf(m.role),
    isOwner: m.role === 'owner',
    joinedAt: m.createdAt.toISOString(),
    lastActiveAt: iso(lastBy.get(u.id) ? new Date(lastBy.get(u.id)!) : null),
  }));
}

async function adminCount(db: Db, workspaceId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), inArray(member.role, ['owner', 'admin'])));
  return Number(r?.n ?? 0);
}

export async function changeSeat(db: Db, workspaceId: string, actorId: string, userId: string, role: SeatRole): Promise<Member> {
  const [m] = await db.select().from(member).where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)));
  if (!m) fail('not_found', 'Not a member of this workspace');
  const was = seatRoleOf(m.role);
  if (was === 'admin' && role !== 'admin' && (await adminCount(db, workspaceId)) <= 1) fail('last_admin', 'A workspace needs at least one admin');
  // Keep "owner" for the owner who stays admin; otherwise store the seat name.
  const stored = role === 'admin' && m.role === 'owner' ? 'owner' : role;
  if (stored !== m.role) await db.update(member).set({ role: stored }).where(eq(member.id, m.id));
  if (was !== role)
    await audit(db, { workspaceId, actorId, action: 'member.role_changed', target: { type: 'user', id: userId, label: null }, details: { from: was, to: role } });
  return (await listMembers(db, workspaceId)).find((x) => x.userId === userId)!;
}

/** Remove a member, or leave (J-173). Their captures stay with the workspace (J-249). */
export async function removeMember(db: Db, workspaceId: string, actorId: string, userId: string, actorSeat: SeatRole) {
  if (actorId !== userId && actorSeat !== 'admin') fail('forbidden', 'Only admins can remove other members');
  const [m] = await db.select().from(member).where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)));
  if (!m) fail('not_found', 'Not a member of this workspace');
  const [{ n }] = (await db.select({ n: count() }).from(member).where(eq(member.organizationId, workspaceId))) as [{ n: number }];
  if (Number(n) <= 1) fail('last_admin', 'You are the only member; delete the workspace instead');
  if (seatRoleOf(m.role) === 'admin' && (await adminCount(db, workspaceId)) <= 1) fail('last_admin', 'Make someone else an admin first');
  await db.delete(member).where(eq(member.id, m.id));
  await db.update(user).set({ activeWorkspaceId: null }).where(and(eq(user.id, userId), eq(user.activeWorkspaceId, workspaceId)));
  await audit(db, { workspaceId, actorId, action: 'member.removed', target: { type: 'user', id: userId, label: null }, details: { left: actorId === userId } });
}

// ---------- audit log (J-178) ----------

export async function listAudit(db: Db, workspaceId: string, q: { limit: number; cursor?: string; actions?: string[] }) {
  const before = q.cursor ? new Date(Buffer.from(q.cursor, 'base64url').toString()) : null;
  const rows = await db
    .select({ a: auditLog, u: { id: user.id, name: user.name, email: user.email, image: user.image } })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.organizationId, workspaceId),
        q.actions?.length ? inArray(auditLog.action, q.actions) : undefined,
        before && !Number.isNaN(before.getTime()) ? lt(auditLog.at, before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(q.limit + 1);
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return {
    items: page.map(({ a, u }) => ({
      id: a.id,
      at: a.at.toISOString(),
      actor: u?.id ? personOf(u) : null,
      action: a.action as never,
      target: a.targetType ? { type: a.targetType, id: a.targetId ?? '', label: a.targetLabel } : null,
      details: (a.details ?? {}) as Record<string, unknown>,
    })),
    returned: page.length,
    hasMore,
    nextCursor: hasMore ? Buffer.from(page[page.length - 1]!.a.at.toISOString()).toString('base64url') : null,
  };
}

// ---------- profile (J-175) ----------

export async function me(db: Db, userId: string, via: 'session' | 'device' | 'personal' | 'upload') {
  const [u] = await db.select().from(user).where(eq(user.id, userId));
  const s = await settingsRow(db, userId);
  const [first, ...rest] = (u!.name ?? '').split(' ');
  return {
    id: u!.id,
    name: u!.name,
    email: u!.email,
    image: u!.image ?? null,
    via,
    firstName: s?.firstName ?? first ?? null,
    lastName: s?.lastName ?? (rest.join(' ') || null),
    roleHint: s?.roleHint ?? null,
    activeWorkspaceId: u!.activeWorkspaceId ?? null,
  };
}

export async function updateProfile(
  db: Db,
  userId: string,
  body: { firstName?: string; lastName?: string; roleHint?: string | null; imageAssetId?: string | null },
) {
  const cur = await me(db, userId, 'session');
  const firstName = body.firstName ?? cur.firstName ?? '';
  const lastName = body.lastName ?? cur.lastName ?? '';
  const set: Record<string, unknown> = {};
  if (body.firstName !== undefined) set.firstName = body.firstName;
  if (body.lastName !== undefined) set.lastName = body.lastName;
  if (body.roleHint !== undefined) set.roleHint = body.roleHint;
  if (body.imageAssetId !== undefined) set.imageAssetId = body.imageAssetId;
  await db
    .insert(userSettings)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...set, updatedAt: new Date() } });
  const userSet: Record<string, unknown> = {};
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
    if (name) userSet.name = name;
  }
  if (body.imageAssetId !== undefined) {
    if (body.imageAssetId === null) userSet.image = null;
    else {
      const [a] = await db.select().from(asset).where(eq(asset.id, body.imageAssetId));
      if (!a || (a.createdBy && a.createdBy !== userId)) fail('invalid_body', 'Avatar upload not found');
      userSet.image = assetUrl(a);
    }
  }
  if (Object.keys(userSet).length) await db.update(user).set(userSet).where(eq(user.id, userId));
  return me(db, userId, 'session');
}

// ---------- account deletion (J-225, J-249) ----------

/** What deleting this account would do: workspaces that go with it, and any that block it. */
export async function deletionPlan(db: Db, userId: string) {
  const mine = await db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
  const erase: { id: string; name: string }[] = [];
  const leave: { id: string; name: string }[] = [];
  const blocked: { id: string; name: string }[] = [];
  for (const w of mine) {
    const others = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, w.id), ne(member.userId, userId)));
    if (!others.length) erase.push({ id: w.id, name: w.name });
    else if (seatRoleOf(w.role) === 'admin' && !others.some((o) => seatRoleOf(o.role) === 'admin')) blocked.push({ id: w.id, name: w.name });
    else leave.push({ id: w.id, name: w.name });
  }
  return { erase, leave, blocked };
}

export async function deleteAccount(db: Db, userId: string) {
  const plan = await deletionPlan(db, userId);
  if (plan.blocked.length) fail('last_admin', `Make someone else an admin of ${plan.blocked.map((b) => b.name).join(', ')} first`);
  const [u] = await db.select().from(user).where(eq(user.id, userId));
  for (const w of plan.erase) await eraseWorkspace(db, w.id);
  // Shared workspaces: membership goes; captures stay (author id set null by the FK), comments show as a deleted account.
  await db.update(comment).set({ authorName: 'Deleted account' }).where(eq(comment.authorUserId, userId));
  for (const w of plan.leave) await audit(db, { workspaceId: w.id, actorId: null, action: 'member.removed', target: { type: 'user', id: userId, label: u?.email ?? null }, details: { accountDeleted: true } });
  await db.delete(apiToken).where(eq(apiToken.userId, userId));
  await db.delete(user).where(eq(user.id, userId));
  if (u?.email) {
    const m = accountDeletedMail({ name: u.email, workspaces: plan.erase.map((w) => w.name), product: currentBrand().name });
    await sendMail(u.email, m.subject, m.text, m.html).catch(() => {});
  }
  return plan.erase.map((w) => w.id);
}

// ---------- onboarding (J-169) ----------

export async function onboarding(db: Db, userId: string, workspaceId: string | null) {
  const raw = ((await settingsRow(db, userId))?.settings ?? {}) as Record<string, unknown>;
  const done: Record<string, boolean> = { extension: false, capture: false, invite: false, integration: false };
  const [dev] = await db
    .select({ n: count() })
    .from(apiToken)
    .where(and(eq(apiToken.userId, userId), eq(apiToken.kind, 'device'), isNull(apiToken.revokedAt)));
  const [cap] = await db
    .select({ n: count() })
    .from(recording)
    .where(and(eq(recording.authorUserId, userId), isNull(recording.deletedAt)));
  done.extension = Number(dev?.n ?? 0) > 0 || raw.extensionSeen === true;
  done.capture = Number(cap?.n ?? 0) > 0;
  if (workspaceId) {
    const [mem] = await db.select({ n: count() }).from(member).where(eq(member.organizationId, workspaceId));
    done.invite = Number(mem?.n ?? 0) > 1;
    // trackers paused: only a webhook ticks the step (an old tracker row is hidden, D-170)
    const [i] = env.features.trackers ? await db.select({ n: count() }).from(integration).where(eq(integration.organizationId, workspaceId)) : [{ n: 0 }];
    const [h] = await db.select({ n: count() }).from(webhook).where(eq(webhook.organizationId, workspaceId));
    done.integration = Number(i?.n ?? 0) + Number(h?.n ?? 0) > 0;
  }
  return {
    steps: onboardingSteps({ trackers: env.features.trackers }).map((s) => ({ ...s, done: done[s.id] ?? false })),
    dismissed: raw.onboardingDismissed === true,
  };
}

export async function dismissOnboarding(db: Db, userId: string) {
  await patchRawSettings(db, userId, { onboardingDismissed: true });
}

// ---------- guests (people given access to a folder who are not members) ----------

export async function folderGuests(db: Db, workspaceId: string) {
  const rows = (await db.execute(sql`
    SELECT fm.id, fm.email, fm.role, fm.user_id, u.name, u.email AS user_email, u.image, f.name AS folder_name, f.short_id
    FROM folder_member fm
    JOIN folder f ON f.id = fm.folder_id
    LEFT JOIN "user" u ON u.id = fm.user_id
    WHERE f.organization_id = ${workspaceId}
      AND (fm.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM member m WHERE m.organization_id = ${workspaceId} AND m.user_id = fm.user_id))
    ORDER BY fm.created_at DESC`)) as unknown as {
    id: string;
    email: string | null;
    role: string;
    user_id: string | null;
    name: string | null;
    user_email: string | null;
    image: string | null;
    folder_name: string;
    short_id: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? r.email ?? 'Guest',
    email: r.user_email ?? r.email,
    image: r.image,
    pending: !r.user_id,
    role: r.role,
    folder: { name: r.folder_name, shortId: r.short_id },
  }));
}
