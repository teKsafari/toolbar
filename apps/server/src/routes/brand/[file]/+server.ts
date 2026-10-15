// Instance logo files (D-112): /brand/logo.svg, logo-dark.png, icon-32.png, email.png and so on.
// With ?v= matching the current brand version they are cached for a year; otherwise for 5 minutes.
// SVG gets a sandbox CSP, so a logo opened on its own runs nothing.
import { error } from '@sveltejs/kit';
import { brandFile } from '#lib/server/branding/index.ts';

export const GET = async ({ params, url, locals }) => {
  const f = await brandFile(locals.brand, params.file);
  if (!f) error(404, { message: 'No such brand file', code: 'not_found' });
  const fresh = url.searchParams.get('v') === locals.brand.version;
  const headers: Record<string, string> = {
    'Content-Type': f.type,
    'Content-Length': String(f.body.byteLength),
    'Cache-Control': fresh ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (f.type === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    headers['Content-Disposition'] = `inline; filename="${params.file}"`;
  }
  return new Response(new Uint8Array(f.body), { headers });
};
