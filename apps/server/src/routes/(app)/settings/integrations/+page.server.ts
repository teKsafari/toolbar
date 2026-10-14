import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { listIntegrations } from '#lib/server/integrations/index.ts';
import { listHooks } from '#lib/server/webhooks/index.ts';

export const load = async ({ parent, locals }) => {
  const { activeWorkspaceId, activeWorkspace } = await parent();
  if (!activeWorkspaceId || !locals.user) error(404, 'No workspace');
  const admin = activeWorkspace?.role === 'admin';
  return {
    items: await listIntegrations(db, activeWorkspaceId),
    webhookCount: admin ? (await listHooks(db, activeWorkspaceId)).length : 0,
    admin,
    workspaceId: activeWorkspaceId,
  };
};
