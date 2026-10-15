import { env } from '#lib/server/env.ts';
import { requireFeature } from '#lib/server/paused.ts';
import { cliBundleAvailable } from '#lib/server/mcp/cli-bundle.ts';

/** J-155: install, sign in and skill commands, with this server's URL filled in. */
export const load = async () => {
  requireFeature(env.features.cli);
  return { serverUrl: env.publicUrl, bundle: await cliBundleAvailable() };
};
