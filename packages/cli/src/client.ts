// Talking to a open-toolbar server: MCP tools over JSON-RPC at /mcp (the same data and shapes agents get)
// and the REST API for uploads. Refreshes OAuth access tokens when they run out.
import { readConfig, writeConfig, type Config } from './config.ts';

export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface Client {
  config: Config;
  /** Call an MCP tool; returns its content blocks, throws CliError on a tool error. */
  tool(name: string, args?: Record<string, unknown>): Promise<Content[]>;
  /** Call a tool whose first text block is JSON. */
  toolJson<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** REST call with the bearer; JSON in and out unless `raw`. */
  rest(method: string, path: string, body?: unknown, opts?: { raw?: BodyInit; headers?: Record<string, string> }): Promise<Response>;
}

let rpcId = 1;

async function refresh(c: Config): Promise<boolean> {
  if (c.via !== 'oauth' || !c.refreshToken || !c.tokenEndpoint || !c.clientId) return false;
  const res = await fetch(c.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId }),
  });
  if (!res.ok) return false;
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  c.token = t.access_token;
  c.refreshToken = t.refresh_token;
  c.expiresAt = Date.now() + t.expires_in * 1000;
  if (!process.env.TOOLBAR_TOKEN) await writeConfig(c);
  return true;
}

export async function connect(): Promise<Client> {
  const config = await readConfig();
  if (!config) throw new CliError('Not signed in. Run: open-toolbar login --server <url> (or set TOOLBAR_SERVER and TOOLBAR_TOKEN).', 2);
  if (config.via === 'oauth' && config.expiresAt && config.expiresAt - Date.now() < 60_000) await refresh(config);

  async function send(input: string, init: RequestInit): Promise<Response> {
    const go = () =>
      fetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${config!.token}`, 'x-toolbar-client': 'cli' } });
    let res = await go().catch((e: Error) => {
      throw new CliError(`Cannot reach ${config!.server}: ${e.message}`);
    });
    if (res.status === 401 && (await refresh(config!))) res = await go();
    if (res.status === 401) throw new CliError('The server refused the sign-in (expired or revoked). Run open-toolbar login again.', 2);
    return res;
  }

  async function tool(name: string, args: Record<string, unknown> = {}): Promise<Content[]> {
    const res = await send(`${config!.server}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
    });
    if (res.status === 403) {
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      throw new CliError(b.message ?? 'This token may not use the CLI. Give it a CLI scope under Settings, API tokens.', 2);
    }
    if (!res.ok) throw new CliError(`Server error ${res.status} on ${name}`);
    const msg = (await res.json()) as { result?: { content: Content[]; isError?: boolean }; error?: { message: string } };
    if (msg.error) throw new CliError(msg.error.message);
    const r = msg.result!;
    if (r.isError) throw new CliError(r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n'));
    return r.content;
  }

  return {
    config,
    tool,
    async toolJson<T>(name: string, args: Record<string, unknown> = {}) {
      const c = await tool(name, args);
      const first = c.find((x) => x.type === 'text') as { text: string } | undefined;
      return JSON.parse(first?.text ?? 'null') as T;
    },
    rest(method, path, body, opts = {}) {
      const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
      let payload: BodyInit | undefined = opts.raw;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      } else if (!payload && method !== 'GET') headers['content-type'] = 'application/json';
      return send(`${config.server}${path}`, { method, headers, body: payload });
    },
  };
}

/** Every page of a paged tool, following nextCursor (at most `max` items). */
export async function allPages<T>(c: Client, name: string, args: Record<string, unknown>, max = 5000): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page: { items: T[]; nextCursor: string | null } = await c.toolJson(name, { ...args, limit: 200, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < max);
  return out;
}

export async function restJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = body as { error?: string; message?: string } | null;
    throw new CliError(`${res.status} ${b?.error ?? ''}${b?.message ? `: ${b.message}` : ''}`.trim());
  }
  return body as T;
}
