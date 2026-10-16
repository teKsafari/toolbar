// Invitations by email and the workspace invite link (J-123, J-173, J-234). Owner: auth area.
// Email invites are rows in Better Auth's `invitation` table (role creator or viewer); the
// invite link is one random token per workspace in `workspace_invite_link`, sealed for redisplay.
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SeatRole } from '@toolbar/shared/api';
import { INVITE_EMAIL_DAYS, INVITE_LINK_DAYS } from '@toolbar/shared/areas/auth';
import type { Db } from '../db/index.ts';
import { invitation, member, organization, user, workspaceInviteLink } from '../db/schema/index.ts';
import { seal, tryUnseal } from '../crypto.ts';
import { env } from '../env.ts';
import { sendMail } from '../mail.ts';
import { hashToken } from '../tokens.ts';
import { addMember, getSettings, setActiveWorkspace } from './workspaces.ts';
import { currentBrand } from '../branding/index.ts';

export type InviteRole = 'creator' | 'viewer';
export type InviteStatus = 'pending' | 'accepted' | 'canceled' | 'expired';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isInvitationId = (s: string) => UUID_RE.test(s);

export const inviteUrl = (idOrToken: string) => `${env.publicUrl}/invite/${idOrToken}`;

const asRole = (r: string | null): InviteRole => (r === 'viewer' ? 'viewer' : 'creator');

function statusOf(row: { status: string; expiresAt: Date }): InviteStatus {
  if (row.status === 'accepted' || row.status === 'canceled') return row.status;
  if (row.status === 'rejected') return 'canceled';
  return row.expiresAt.getTime() < Date.now() ? 'expired' : 'pending';
}

function inviteDto(row: typeof invitation.$inferSelect, inviter: { id: string; name: string; email: string; image: string | null } | null) {
  return {
    id: row.id,
    email: row.email,
    role: asRole(row.role),
    status: statusOf(row),
    invitedBy: inviter ? { id: inviter.id, name: inviter.name, email: inviter.email, image: inviter.image } : null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function listInvites(db: Db, workspaceId: string) {
  const rows = await db
    .select({ inv: invitation, inviter: { id: user.id, name: user.name, email: user.email, image: user.image } })
    .from(invitation)
    .leftJoin(user, eq(user.id, invitation.inviterId))
    .where(and(eq(invitation.organizationId, workspaceId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt));
  return rows.map((r) => inviteDto(r.inv, r.inviter)).filter((i) => i.status === 'pending');
}

/**
 * Invite addresses (J-123). Existing members are skipped; a pending invite for the same
 * address is refreshed with the new role and sent again. Each invite emails a join link.
 */
export async function createInvites(
  db: Db,
  opts: { workspaceId: string; inviter: { id: string; name: string; email: string; image: string | null }; emails: string[]; role: InviteRole },
) {
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, opts.workspaceId));
  if (!org) return [];
  const emails = [...new Set(opts.emails.map((e) => e.trim().toLowerCase()))];
  const members = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, opts.workspaceId), inArray(sql`lower(${user.email})`, emails)));
  const skip = new Set(members.map((m) => m.email.toLowerCase()));
  const expiresAt = new Date(Date.now() + INVITE_EMAIL_DAYS * 86_400_000);
  const out = [];
  for (const email of emails) {
    if (skip.has(email)) continue;
    const [pending] = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, opts.workspaceId), eq(invitation.email, email), eq(invitation.status, 'pending')));
    const [row] = pending
      ? await db.update(invitation).set({ role: opts.role, expiresAt, inviterId: opts.inviter.id }).where(eq(invitation.id, pending.id)).returning()
      : await db
          .insert(invitation)
          .values({ organizationId: opts.workspaceId, email, role: opts.role, status: 'pending', expiresAt, inviterId: opts.inviter.id })
          .returning();
    const url = inviteUrl(row!.id);
    const seat = opts.role === 'viewer' ? 'a viewer (view and comment)' : 'a creator (capture, comment and organise)';
    await sendMail(
      email,
      `${opts.inviter.name} invited you to ${org.name} on ${currentBrand().name}`,
      `${opts.inviter.name} (${opts.inviter.email}) invited you to join ${org.name} on ${currentBrand().name} as ${seat}.\n\n` +
        `Join: ${url}\n\nThe invitation expires on ${expiresAt.toDateString()}.`,
      `<p>${esc(opts.inviter.name)} (${esc(opts.inviter.email)}) invited you to join <b>${esc(org.name)}</b> on ${currentBrand().name} as ${seat}.</p>` +
        `<p><a href="${url}">Join ${esc(org.name)}</a></p><p style="color:#666">The invitation expires on ${expiresAt.toDateString()}.</p>`,
    );
    out.push(inviteDto(row!, opts.inviter));
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Cancel a pending invite. Returns its workspace id, or null when there is none. */
export async function cancelInvite(db: Db, id: string): Promise<string | null> {
  if (!isInvitationId(id)) return null;
  const [row] = await db
    .update(invitation)
    .set({ status: 'canceled' })
    .where(and(eq(invitation.id, id), eq(invitation.status, 'pending')))
    .returning({ ws: invitation.organizationId });
  return row?.ws ?? null;
}

export async function invitationWorkspace(db: Db, id: string): Promise<string | null> {
  if (!isInvitationId(id)) return null;
  const [row] = await db.select({ ws: invitation.organizationId }).from(invitation).where(eq(invitation.id, id));
  return row?.ws ?? null;
}

// ---------- invite link ----------

function linkDto(enabled: boolean, row: { tokenEnc: Buffer; expiresAt: Date } | null) {
  const token = enabled && row ? tryUnseal(row.tokenEnc, 'invite-link') : null;
  return {
    enabled,
    url: token ? inviteUrl(token) : null,
    role: 'creator' as const,
    expiresAt: enabled && row ? row.expiresAt.toISOString() : null,
  };
}

async function writeLink(db: Db, workspaceId: string, createdBy: string | null) {
  const token = randomBytes(16).toString('base64url');
  const values = {
    organizationId: workspaceId,
    tokenHash: hashToken(token),
    tokenEnc: seal(token, 'invite-link'),
    expiresAt: new Date(Date.now() + INVITE_LINK_DAYS * 86_400_000),
    createdBy,
    createdAt: new Date(),
  };
  const [row] = await db
    .insert(workspaceInviteLink)
    .values(values)
    .onConflictDoUpdate({ target: workspaceInviteLink.organizationId, set: values })
    .returning();
  return row!;
}

/** The workspace's invite link; a fresh one is made when none exists or the old one expired. */
export async function getInviteLink(db: Db, workspaceId: string, userId: string) {
  const s = await getSettings(db, workspaceId);
  if (!s?.inviteLinkEnabled) return linkDto(false, null);
  let [row] = await db.select().from(workspaceInviteLink).where(eq(workspaceInviteLink.organizationId, workspaceId));
  // a stored token that no longer decrypts (new auth secret or key label) is replaced like an expired one
  if (!row || row.expiresAt.getTime() < Date.now() || tryUnseal(row.tokenEnc, 'invite-link') === null) row = await writeLink(db, workspaceId, userId);
  return linkDto(true, row);
}

/** Replace the link; the old token stops working at once. */
export async function resetInviteLink(db: Db, workspaceId: string, userId: string) {
  const s = await getSettings(db, workspaceId);
  const row = await writeLink(db, workspaceId, userId);
  return linkDto(!!s?.inviteLinkEnabled, row);
}

// ---------- preview and accept ----------

type Resolved =
  | { kind: 'email'; workspaceId: string; workspaceName: string; inviterName: string | null; role: InviteRole; email: string; status: InviteStatus; id: string }
  | { kind: 'link'; workspaceId: string; workspaceName: string; inviterName: string | null; role: 'creator'; email: null; status: InviteStatus };

/** What an invitation id or link token leads to, or null when unknown. */
export async function resolveInvite(db: Db, idOrToken: string): Promise<Resolved | null> {
  if (isInvitationId(idOrToken)) {
    const [r] = await db
      .select({ inv: invitation, ws: organization.name, inviter: user.name })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .leftJoin(user, eq(user.id, invitation.inviterId))
      .where(eq(invitation.id, idOrToken));
    if (!r) return null;
    return {
      kind: 'email',
      id: r.inv.id,
      workspaceId: r.inv.organizationId,
      workspaceName: r.ws,
      inviterName: r.inviter,
      role: asRole(r.inv.role),
      email: r.inv.email,
      status: statusOf(r.inv),
    };
  }
  const [r] = await db
    .select({ link: workspaceInviteLink, ws: organization.name, settings: organization.settings, inviter: user.name })
    .from(workspaceInviteLink)
    .innerJoin(organization, eq(organization.id, workspaceInviteLink.organizationId))
    .leftJoin(user, eq(user.id, workspaceInviteLink.createdBy))
    .where(eq(workspaceInviteLink.tokenHash, hashToken(idOrToken)));
  if (!r) return null;
  const enabled = (r.settings as { inviteLinkEnabled?: boolean } | null)?.inviteLinkEnabled !== false;
  if (!enabled) return null;
  return {
    kind: 'link',
    workspaceId: r.link.organizationId,
    workspaceName: r.ws,
    inviterName: r.inviter,
    role: 'creator',
    email: null,
    status: r.link.expiresAt.getTime() < Date.now() ? 'expired' : 'pending',
  };
}

export type AcceptResult =
  | { ok: true; workspaceId: string; role: SeatRole }
  | { ok: false; code: 'not_found' | 'expired' | 'forbidden'; message: string };

/**
 * Join from an email invitation or the invite link (J-123, J-234). An email invitation only
 * works for the address it was sent to. Joining switches the user to that workspace.
 */
export async function acceptInvite(db: Db, idOrToken: string, me: { id: string; email: string }): Promise<AcceptResult> {
  const inv = await resolveInvite(db, idOrToken);
  if (!inv) return { ok: false, code: 'not_found', message: 'This invitation does not exist or was replaced.' };
  if (inv.kind === 'email' && inv.email.toLowerCase() !== me.email.toLowerCase())
    return { ok: false, code: 'forbidden', message: `This invitation was sent to ${inv.email}. Sign in with that address to accept it.` };
  if (inv.status === 'canceled') return { ok: false, code: 'not_found', message: 'This invitation was canceled.' };
  if (inv.status === 'expired') return { ok: false, code: 'expired', message: 'This invitation has expired. Ask for a new one.' };
  // Accepting twice is harmless: addMember keeps the seat a member already has.
  const role = await addMember(db, inv.workspaceId, me.id, inv.role);
  if (inv.kind === 'email') await db.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, inv.id));
  await setActiveWorkspace(db, me.id, inv.workspaceId);
  return { ok: true, workspaceId: inv.workspaceId, role };
}
