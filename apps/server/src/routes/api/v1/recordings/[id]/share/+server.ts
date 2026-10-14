// STAND-IN for server-core's sharing.get (share settings and links). Replace at merge.
import { json } from '@sveltejs/kit';
import { handle, memberAccess } from '#lib/server/viewer/access.ts';
import { shareSettings } from '#lib/server/viewer/standin.ts';

export const GET = handle(async (event) => {
  const ctx = await memberAccess(event, event.params.id!);
  return json(await shareSettings(ctx.rec, ctx.user!.id));
});
