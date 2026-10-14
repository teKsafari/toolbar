// Page data for /c/[id] (members) and /s/[token] (share links).
import type { RequestEvent } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { folder, integration, member, user } from '#lib/server/db/schema/index.ts';
import type { ViewerData } from '#lib/components/viewer/types.ts';
import type { ViewerCtx } from './access.ts';
import { listThreads } from './comments.ts';
import { captureDetail, transcriptCues } from './detail.ts';

export async function viewerPageData(event: Pick<RequestEvent, 'url'>, ctx: ViewerCtx, mode: 'member' | 'share'): Promise<ViewerData> {
  const isMember = !!ctx.role;
  const [detail, threads, cues] = await Promise.all([captureDetail(ctx), listThreads(ctx), transcriptCues(ctx.rec.id)]);
  const folders = isMember
    ? await db.select({ id: folder.id, name: folder.name }).from(folder).where(eq(folder.organizationId, ctx.rec.organizationId)).orderBy(asc(folder.name))
    : [];
  const members = isMember
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, ctx.rec.organizationId))
        .orderBy(asc(user.name))
    : [];
  const integrations = isMember && mode === 'member'
    ? (await db.select().from(integration).where(eq(integration.organizationId, ctx.rec.organizationId))).map((i) => ({
        id: i.id,
        type: i.type,
        name: ((i.config as { name?: string } | null)?.name ?? i.type.replace(/^\w/, (c) => c.toUpperCase())) as string,
      }))
    : [];
  const t = Number(event.url.searchParams.get('t'));
  const highlight = event.url.searchParams.get('comment');
  const devtools = mode === 'member' || ((ctx.share?.devtools ?? true) && event.url.searchParams.get('devtools') !== '0');
  if (!devtools) detail.canEdit = false;
  return {
    mode,
    detail,
    threads,
    me: ctx.user ? { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, image: ctx.user.image ?? null } : null,
    role: ctx.role,
    shareToken: ctx.share?.token ?? null,
    devtools,
    folders,
    members,
    integrations,
    cues,
    startAt: Number.isFinite(t) && t > 0 ? t : null,
    highlight: highlight && /^[0-9a-f-]{36}$/i.test(highlight) ? highlight : null,
  };
}
