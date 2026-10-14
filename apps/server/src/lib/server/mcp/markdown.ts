// Markdown summary of a shared capture for plain fetches (J-153): `GET /s/<token>.md`, or
// `GET /s/<token>` with `Accept: text/markdown`. Front matter, signal counts, comments, and
// pointers to the MCP server and the CLI. Same access rules as the share page.
import { shareMarkdown, signalsOf } from '@toolbar/shared/derive';
import { db } from '../db/index.ts';
import { env } from '../env.ts';
import { findShare } from '../share/tokens.ts';
import { seatOf } from '../share/access.ts';
import { briefOf, CLI_NAME, mcpUrl, preparedOf, screenshotAssets } from './data.ts';

const TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' };

/** True when the client asks for markdown ahead of HTML. */
export function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const types = accept.split(',').map((p) => {
    const [t, ...params] = p.trim().split(';');
    const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    return { t: t!.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
  });
  const md = Math.max(0, ...types.filter((x) => x.t === 'text/markdown' || x.t === 'text/x-markdown').map((x) => x.q));
  const html = Math.max(0, ...types.filter((x) => x.t === 'text/html').map((x) => x.q));
  return md > 0 && md >= html;
}

export const markdownUrlOf = (token: string) => `${env.publicUrl}/s/${token}.md`;

export async function shareMarkdownResponse(token: string, userId: string | null): Promise<Response> {
  const s = await findShare(db, token);
  if (!s) return new Response('Not found\n', { status: 404, headers: TEXT });
  const { rec, link } = s;
  if (rec.access !== 'anyone') {
    const seat = userId ? await seatOf(db, userId, rec.organizationId) : null;
    if (!seat) return new Response(userId ? 'Not found\n' : 'Sign in to see this capture.\n', { status: userId ? 404 : 401, headers: TEXT });
  }
  const url = `${env.publicUrl}/s/${token}`;
  const shots = await screenshotAssets(db, rec.id);
  const imageUrl = shots.main ? `${url}/media/screenshot` : rec.thumbKey ? `${url}/media/thumb` : null;
  const brief = await briefOf(db, rec, { url, imageUrl });
  const p = link.devtools ? await preparedOf(db, rec) : null;
  const body = shareMarkdown(brief, p ? signalsOf(p) : null, { mcpUrl: mcpUrl(), cli: CLI_NAME });
  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'private, no-store',
      link: `<${url}>; rel="canonical"; type="text/html"`,
      vary: 'Accept',
    },
  });
}
