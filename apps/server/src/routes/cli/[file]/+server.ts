// The CLI and its install scripts (J-155): /cli/nib.mjs, /cli/install.sh, /cli/install.ps1.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '#lib/server/env.ts';
import { cliBundle, installPs1, installSh } from '#lib/server/mcp/cli-bundle.ts';

export const GET: RequestHandler = async ({ params }) => {
  const text = (body: string, type: string) => new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache' } });
  if (params.file === 'install.sh') return text(installSh(env.publicUrl), 'text/x-shellscript');
  if (params.file === 'install.ps1') return text(installPs1(env.publicUrl), 'text/plain');
  if (params.file === 'nib.mjs') {
    const b = await cliBundle();
    if (!b) error(404, { message: 'This server has no CLI build. Run pnpm --filter @toolbar/cli build.' });
    return new Response(new Uint8Array(b!), { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
  }
  error(404, { message: 'Not found' });
};
