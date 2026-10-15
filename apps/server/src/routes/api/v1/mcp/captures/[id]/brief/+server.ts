import { and, eq, isNull } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { agentPrompts, copyForAi } from '@toolbar/shared/derive';
import { db } from '#lib/server/db/index.ts';
import { mcpGrant } from '#lib/server/db/schema/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { env } from '#lib/server/env.ts';
import { agentPointers, briefOf, CLI_NAME, mcpUrl, memberUrlOf, preparedOf } from '#lib/server/mcp/data.ts';
import { SHARE_TOKEN_HEADER } from '@toolbar/shared/api';

// Agent tab (J-152) and copy-for-AI: prompts with the capture URL and the markdown bundle.
export const GET = apiRoute(ROUTES['agent.captureBrief'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'viewer' });
  const shareToken = a.via === 'share' ? event.request.headers.get(SHARE_TOKEN_HEADER) : null;
  const captureUrl = shareToken ? `${env.publicUrl}/s/${shareToken}` : memberUrlOf(a.rec.id);
  const userId = event.locals.user?.id;
  const connected = userId
    ? (await db.select({ id: mcpGrant.id }).from(mcpGrant).where(and(eq(mcpGrant.userId, userId), isNull(mcpGrant.revokedAt))).limit(1)).length > 0
    : false;
  const devtools = !(a.via === 'share' && a.share && !a.share.devtools);
  const p = devtools ? await preparedOf(db, a.rec) : null;
  const brief = await briefOf(db, a.rec, { url: captureUrl });
  return {
    captureUrl,
    mcpUrl: mcpUrl(),
    connected,
    prompts: agentPrompts(captureUrl, mcpUrl()),
    markdown: copyForAi(brief, p, agentPointers()),
    // the paused CLI (docs/scope.md) is named only while FEATURE_CLI is on
    cli: env.features.cli ? CLI_NAME : null,
  };
});
