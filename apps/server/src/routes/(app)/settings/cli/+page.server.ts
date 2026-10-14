import { env } from '#lib/server/env.ts';
import { cliBundleAvailable } from '#lib/server/mcp/cli-bundle.ts';

/** J-155: install, sign in and skill commands, with this server's URL filled in. */
export const load = async () => ({ serverUrl: env.publicUrl, bundle: await cliBundleAvailable() });
