import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { workspaceDetail } from '#lib/server/dashboard/workspace.ts';
import { env } from '#lib/server/env.ts';
import { setting } from '#lib/server/settings/index.ts';
import { projectDefaults } from '#lib/server/projects.ts';

export const load = async ({ parent, locals }) => {
  const { activeWorkspaceId } = await parent();
  if (!activeWorkspaceId || !locals.user) error(404, 'No workspace');
  return {
    ws: await workspaceDetail(db, activeWorkspaceId, locals.user.id),
    sso: env.auth.oidc ? [setting('oidcProviderName') ?? env.auth.oidc.name] : [],
    /** the instance defaults a workspace's project defaults fall back to (D-187) */
    instanceDefaults: await projectDefaults(db, null),
  };
};
