// nib: the Nib command line (J-155, J-244 to J-247). Reads captures with the same data and JSON
// shapes as the MCP tools, writes frames and screenshots to disk, pulls a whole capture into a
// folder, installs the agent skill, and makes captures for agents.
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { agentSkill, CLI_BIN } from '@toolbar/shared/areas/agent';
import { PRODUCT_NAME } from '@toolbar/shared/constants';
import { allPages, CliError, connect, restJson, type Client, type Content } from './client.ts';
import { clearConfig, configPath, readConfig } from './config.ts';
import { loginWithBrowser, loginWithToken } from './login.ts';
import { createCommand } from './create.ts';
import { recordCommand } from './record.ts';

const VERSION = '0.1.0';

const out = (v: unknown): void => {
  process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v, null, 2)) + '\n');
};
const log = (s: string) => process.stderr.write(s + '\n');
const csv = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const num = (v: string | undefined, name: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new CliError(`--${name} must be a number`);
  return n;
};

const HELP = `${CLI_BIN} ${VERSION}: ${PRODUCT_NAME} captures from the terminal

Sign in
  ${CLI_BIN} login --server <url>             approve in the browser (OAuth)
  ${CLI_BIN} login --server <url> --token <t> use a personal token (Settings, API tokens)
  ${CLI_BIN} whoami | logout

Read (every <capture> is an id, a /c/<id> URL or a /s/<token> share link)
  ${CLI_BIN} ls [--folder <id|none>] [--kind video,screenshot] [--limit n] [--cursor c]
  ${CLI_BIN} search <text>
  ${CLI_BIN} get <capture>                    details and a guide to the next reads
  ${CLI_BIN} console <capture> [--level error,warn] [--kind ...] [--from ms] [--to ms] [--q text]
  ${CLI_BIN} network <capture> [--status 4xx,5xx,failed,pending] [--method POST] [--host h]
                 [--type fetch,xhr] [--bodies errors|all|none] [--no-headers] [--q text]
  ${CLI_BIN} messages <capture> --rid <rid>    WebSocket or SSE messages of one stream
  ${CLI_BIN} actions <capture>                 clicks, typing, keys, navigations
  ${CLI_BIN} events <capture> [--kind console,error]   raw events
  ${CLI_BIN} frames <capture> [--at 5000,6200 | --from a --to b --count n | --overview] [--size 360|720|1080] [--out dir]
  ${CLI_BIN} screenshots <capture> [--full] [--out dir]
  ${CLI_BIN} transcript <capture> | comments <capture> | metadata <capture> | link <capture>
  ${CLI_BIN} pull <capture> [--out dir]        everything into a folder, with summary.md
  Paged commands print { items, total, returned, hasMore, nextCursor }; add --cursor <nextCursor> or --all.

Write
  ${CLI_BIN} comment <capture> "<markdown>" [--at <videoMs>] [--reply <commentId>]
  ${CLI_BIN} update <capture> [--title t] [--description d] [--folder <id|none>]
  ${CLI_BIN} create --json payload.json        annotated screenshot (box, arrow, text, redact, blur)
  ${CLI_BIN} create <video.webm|mp4> [--trace trace.zip] [--title t] [--poster img]
  ${CLI_BIN} record --cdp <http://host:port> [-- <command...>]   record a Chromium driven by an agent

Agents
  ${CLI_BIN} skill install [--agent claude|codex|cursor] [--dir path]
  ${CLI_BIN} skill print
`;

type Opts = ParseArgsConfig['options'];
const common: Opts = { cursor: { type: 'string' }, limit: { type: 'string' }, all: { type: 'boolean' }, json: { type: 'boolean' } };

type Values = Record<string, string | boolean | undefined> & { cursor?: string; limit?: string; all?: boolean; json?: boolean };

function parse(argv: string[], options: Opts): { values: Values; positionals: string[] } {
  const r = parseArgs({ args: argv, options: { ...common, ...options, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  return { values: r.values as Values, positionals: r.positionals };
}

function need(pos: string[], i: number, what: string): string {
  const v = pos[i];
  if (!v) throw new CliError(`Missing ${what}. See ${CLI_BIN} --help.`);
  return v;
}

async function paged(c: Client, tool: string, args: Record<string, unknown>, v: Record<string, unknown>) {
  if (v.all) {
    const items = await allPages(c, tool, args);
    return { items, total: items.length, returned: items.length, hasMore: false, nextCursor: null };
  }
  return c.toolJson(tool, { ...args, ...(v.limit ? { limit: Number(v.limit) } : {}), ...(v.cursor ? { cursor: v.cursor } : {}) });
}

const idOf = (details: { id: string }) => details.id.slice(-8);

async function writeImages(contents: Content[], dir: string, names: (i: number, label: string) => string) {
  await mkdir(dir, { recursive: true });
  const files: { file: string; label: string }[] = [];
  let label = '';
  let i = 0;
  for (const c of contents) {
    if (c.type === 'text') label = c.text;
    else {
      const ext = c.mimeType === 'image/png' ? 'png' : c.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const file = join(dir, `${names(i++, label)}.${ext}`);
      await writeFile(file, Buffer.from(c.data, 'base64'));
      files.push({ file, label });
    }
  }
  return files;
}

function frameArgs(v: Record<string, string | boolean | undefined>) {
  const at = csv(v.at as string | undefined)?.map((x) => num(x, 'at')!);
  const args: Record<string, unknown> = { size: (v.size as string) ?? '720' };
  if (!v.overview) {
    if (at?.length) args.at = at;
    else if (v.from !== undefined && v.to !== undefined) Object.assign(args, { from: num(v.from as string, 'from'), to: num(v.to as string, 'to'), count: num(v.count as string, 'count') ?? 3 });
  }
  return args;
}

async function frames(c: Client, ref: string, v: Record<string, string | boolean | undefined>, dirDefault: (id: string) => string) {
  const det = await c.toolJson<{ id: string }>('get_capture', { capture: ref });
  const dir = resolve((v.out as string) ?? dirDefault(idOf(det)));
  const contents = await c.tool('get_frames', { capture: ref, ...frameArgs(v) });
  const files = await writeImages(contents, dir, (i, label) => {
    const m = /videoMs (\d+)/.exec(label);
    return m ? `frame-${m[1]}` : i === 0 && /Overview/.test(label) ? 'overview' : `frame-${i}`;
  });
  const note = contents.find((x) => x.type === 'text' && /Overview/.test(x.text)) as { text: string } | undefined;
  return { dir, files: files.map((f) => f.file), ...(note ? { note: note.text } : {}) };
}

async function pull(c: Client, ref: string, outDir: string | undefined) {
  const [detailsBlock, guideBlock] = (await c.tool('get_capture', { capture: ref })) as { type: 'text'; text: string }[];
  const details = JSON.parse(detailsBlock!.text) as { id: string; kind: string; devtools: boolean; media: { screenshot: unknown } };
  const dir = resolve(outDir ?? `${CLI_BIN}-${idOf(details)}`);
  await mkdir(dir, { recursive: true });
  const w = (name: string, data: unknown) => writeFile(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  const written: string[] = [];
  const save = async (name: string, data: unknown) => {
    await w(name, data);
    written.push(name);
  };
  await save('details.json', details);
  await save('guide.md', guideBlock?.text ?? '');
  if (details.devtools) {
    await save('console.json', await allPages(c, 'get_console_logs', { capture: ref }));
    await save('network.json', await allPages(c, 'get_network_requests', { capture: ref, bodies: 'all', headers: true }));
    await save('actions.json', await allPages(c, 'get_user_events', { capture: ref }));
    await save('events.json', await allPages(c, 'get_events', { capture: ref }, 20000));
  }
  await save('comments.json', await c.toolJson('list_comments', { capture: ref }));
  await save('transcript.json', await c.toolJson('get_transcript', { capture: ref }));
  if (details.kind === 'video' || details.kind === 'screen') {
    const f = await c.tool('get_frames', { capture: ref, size: '720' }).catch(() => [] as Content[]);
    const files = await writeImages(f, join(dir, 'frames'), () => 'overview');
    written.push(...files.map((x) => x.file.slice(dir.length + 1)));
  }
  if (details.media.screenshot) {
    const s = await c.tool('get_screenshots', { capture: ref, full: true }).catch(() => [] as Content[]);
    const files = await writeImages(s, join(dir, 'screenshots'), (i) => (i === 0 ? 'screenshot' : 'full'));
    written.push(...files.map((x) => x.file.slice(dir.length + 1)));
  }
  // the copy-for-AI bundle as a cached structured summary
  const brief = await c.rest('GET', `/api/v1/mcp/captures/${details.id}/brief`).then((r) => (r.ok ? (r.json() as Promise<{ markdown: string }>) : null)).catch(() => null);
  if (brief) await save('summary.md', brief.markdown);
  return { dir, files: written };
}

async function skill(argv: string[]) {
  const { values: v, positionals: pos } = parse(argv, { agent: { type: 'string' }, dir: { type: 'string' } });
  const sub = pos[0] ?? 'install';
  const text = agentSkill(CLI_BIN);
  if (sub === 'print') return out(text);
  if (sub !== 'install') throw new CliError('Use: skill install | skill print');
  const agent = (v.agent as string) ?? 'claude';
  const home = homedir();
  const target =
    (v.dir as string | undefined) ??
    (agent === 'claude'
      ? join(home, '.claude', 'skills', 'nib-captures')
      : agent === 'codex'
        ? join(home, '.codex', 'skills', 'nib-captures')
        : agent === 'cursor'
          ? join(process.cwd(), '.cursor', 'rules')
          : null);
  if (!target) throw new CliError('--agent is claude, codex or cursor (or pass --dir)');
  await mkdir(target, { recursive: true });
  const file = join(target, agent === 'cursor' && !v.dir ? 'nib-captures.mdc' : 'SKILL.md');
  await writeFile(file, text);
  out({ installed: file });
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') return out(HELP);
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') return out(VERSION);

  switch (cmd) {
    case 'login': {
      const { values: v } = parse(rest, { server: { type: 'string' }, token: { type: 'string' }, 'no-open': { type: 'boolean' } });
      const server = (v.server as string | undefined) ?? process.env.NIB_SERVER ?? (await readConfig())?.server;
      if (!server) throw new CliError('Pass --server <url> (the address of your server).');
      const token = (v.token as string | undefined) ?? (process.env.NIB_LOGIN_TOKEN || undefined);
      if (token) {
        const me = await loginWithToken(server, token);
        return out({ signedIn: true, server, as: me.email, via: 'token', config: configPath() });
      }
      await loginWithBrowser(server, { open: !v['no-open'], log });
      const c = await connect();
      const me = await restJson<{ email: string }>(await c.rest('GET', '/api/v1/me'));
      return out({ signedIn: true, server, as: me.email, via: 'oauth', config: configPath() });
    }
    case 'logout': {
      await clearConfig();
      return out({ signedIn: false });
    }
    case 'whoami': {
      const c = await connect();
      const me = await restJson<{ name: string; email: string; via: string }>(await c.rest('GET', '/api/v1/me'));
      return out({ server: c.config.server, name: me.name, email: me.email, via: c.config.via });
    }
    case 'skill':
      return skill(rest);
    case 'create':
      return out(await createCommand(rest, { log }));
    case 'record':
      return out(await recordCommand(rest, { log }));
  }

  const c = await connect();
  switch (cmd) {
    case 'ls':
    case 'list': {
      const { values: v } = parse(rest, { folder: { type: 'string' }, kind: { type: 'string' }, workspace: { type: 'string' } });
      return out(await paged(c, 'list_captures', { folderId: v.folder, kinds: csv(v.kind as string), workspaceId: v.workspace }, v));
    }
    case 'search': {
      const { values: v, positionals: pos } = parse(rest, { kind: { type: 'string' }, folder: { type: 'string' }, author: { type: 'string' } });
      const text = pos.join(' ');
      if (!v.kind && !v.folder && !v.author) return out(await c.toolJson('search', { query: need(pos, 0, 'search text') }));
      return out(await paged(c, 'search_captures', { text: text || undefined, kinds: csv(v.kind as string), folderId: v.folder, authorEmail: v.author }, v));
    }
    case 'get':
    case 'details': {
      const { positionals: pos, values: v } = parse(rest, {});
      const blocks = (await c.tool('get_capture', { capture: need(pos, 0, 'capture') })) as { type: 'text'; text: string }[];
      const details = JSON.parse(blocks[0]!.text);
      if (v.json) return out(details);
      return out({ ...details, guide: blocks[1]?.text ?? null });
    }
    case 'console': {
      const { values: v, positionals: pos } = parse(rest, { level: { type: 'string' }, kind: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, q: { type: 'string' } });
      return out(
        await paged(c, 'get_console_logs', { capture: need(pos, 0, 'capture'), levels: csv(v.level as string), kinds: csv(v.kind as string), fromMs: num(v.from as string, 'from'), toMs: num(v.to as string, 'to'), q: v.q }, v),
      );
    }
    case 'network': {
      const { values: v, positionals: pos } = parse(rest, {
        status: { type: 'string' },
        method: { type: 'string' },
        host: { type: 'string' },
        type: { type: 'string' },
        bodies: { type: 'string' },
        'no-headers': { type: 'boolean' },
        'errors-only': { type: 'boolean' },
        from: { type: 'string' },
        to: { type: 'string' },
        q: { type: 'string' },
      });
      return out(
        await paged(
          c,
          'get_network_requests',
          {
            capture: need(pos, 0, 'capture'),
            status: csv(v.status as string),
            methods: csv(v.method as string),
            hosts: csv(v.host as string),
            types: csv(v.type as string),
            bodies: v.bodies ?? 'errors',
            headers: !v['no-headers'],
            errorsOnly: v['errors-only'] || undefined,
            fromMs: num(v.from as string, 'from'),
            toMs: num(v.to as string, 'to'),
            q: v.q,
          },
          v,
        ),
      );
    }
    case 'messages': {
      const { values: v, positionals: pos } = parse(rest, { rid: { type: 'string' }, direction: { type: 'string' }, q: { type: 'string' } });
      if (!v.rid) throw new CliError('Pass --rid <rid> of a websocket or eventsource row (from nib network --type websocket,eventsource).');
      return out(await paged(c, 'get_stream_messages', { capture: need(pos, 0, 'capture'), rid: v.rid, direction: v.direction, q: v.q }, v));
    }
    case 'actions':
    case 'user-events': {
      const { values: v, positionals: pos } = parse(rest, { type: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, q: { type: 'string' } });
      return out(await paged(c, 'get_user_events', { capture: need(pos, 0, 'capture'), types: csv(v.type as string), fromMs: num(v.from as string, 'from'), toMs: num(v.to as string, 'to'), q: v.q }, v));
    }
    case 'events': {
      const { values: v, positionals: pos } = parse(rest, { kind: { type: 'string' }, ctx: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, q: { type: 'string' } });
      return out(await paged(c, 'get_events', { capture: need(pos, 0, 'capture'), kinds: csv(v.kind as string), ctx: v.ctx, fromMs: num(v.from as string, 'from'), toMs: num(v.to as string, 'to'), q: v.q }, v));
    }
    case 'frames': {
      const { values: v, positionals: pos } = parse(rest, { at: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, count: { type: 'string' }, overview: { type: 'boolean' }, size: { type: 'string' }, out: { type: 'string' } });
      return out(await frames(c, need(pos, 0, 'capture'), v as Record<string, string | boolean | undefined>, (id) => join(`${CLI_BIN}-${id}`, 'frames')));
    }
    case 'screenshots': {
      const { values: v, positionals: pos } = parse(rest, { full: { type: 'boolean' }, out: { type: 'string' } });
      const ref = need(pos, 0, 'capture');
      const det = await c.toolJson<{ id: string }>('get_capture', { capture: ref });
      const dir = resolve((v.out as string) ?? join(`${CLI_BIN}-${idOf(det)}`, 'screenshots'));
      const files = await writeImages(await c.tool('get_screenshots', { capture: ref, full: !!v.full }), dir, (i) => (i === 0 ? 'screenshot' : 'full'));
      return out({ dir, files: files.map((f) => f.file) });
    }
    case 'transcript':
      return out(await c.toolJson('get_transcript', { capture: need(parse(rest, {}).positionals, 0, 'capture') }));
    case 'comments':
      return out(await c.toolJson('list_comments', { capture: need(parse(rest, {}).positionals, 0, 'capture') }));
    case 'metadata':
      return out(await c.toolJson('get_metadata', { capture: need(parse(rest, {}).positionals, 0, 'capture') }));
    case 'link':
      return out(await c.toolJson('get_share_link', { capture: need(parse(rest, {}).positionals, 0, 'capture') }));
    case 'pull': {
      const { values: v, positionals: pos } = parse(rest, { out: { type: 'string' } });
      return out(await pull(c, need(pos, 0, 'capture'), v.out as string | undefined));
    }
    case 'comment': {
      const { values: v, positionals: pos } = parse(rest, { at: { type: 'string' }, reply: { type: 'string' } });
      const body = pos.slice(1).join(' ');
      if (!body.trim()) throw new CliError('Pass the comment text after the capture.');
      return out(await c.toolJson('create_comment', { capture: need(pos, 0, 'capture'), body, videoMs: num(v.at as string, 'at'), parentId: v.reply }));
    }
    case 'update': {
      const { values: v, positionals: pos } = parse(rest, { title: { type: 'string' }, description: { type: 'string' }, folder: { type: 'string' } });
      const folderId = v.folder === undefined ? undefined : v.folder === 'none' ? null : v.folder;
      return out(await c.toolJson('update_capture', { capture: need(pos, 0, 'capture'), title: v.title, description: v.description, folderId }));
    }
    default:
      throw new CliError(`Unknown command ${cmd}. See ${CLI_BIN} --help.`);
  }
}

const isEntry = (() => {
  try {
    const self = new URL(import.meta.url).pathname;
    const arg = process.argv[1] ? resolve(process.argv[1]) : '';
    return arg === self || /(^|\/)(nib|nib\.mjs|main\.ts)$/.test(arg);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    if (e instanceof CliError) {
      log(`${CLI_BIN}: ${e.message}`);
      process.exit(e.exitCode);
    }
    if (e instanceof TypeError && /Unknown option|Unexpected argument/.test((e as Error).message)) {
      log(`${CLI_BIN}: ${(e as Error).message}`);
      process.exit(2);
    }
    log(`${CLI_BIN}: ${(e as Error).stack ?? String(e)}`);
    process.exit(1);
  });
}
