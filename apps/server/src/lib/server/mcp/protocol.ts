// Streamable HTTP MCP endpoint (MCP spec "Transports"), stateless: every POST carries one
// JSON-RPC message or a batch and gets a JSON reply; notifications get 202. No sessions and no
// server-initiated stream, so GET and DELETE answer 405. Auth: OAuth access token or a personal
// token with an mcp scope; a missing or bad token gets 401 with the resource metadata pointer.
import { MCP_PROTOCOL_VERSIONS, MCP_SERVER_NAME } from '@toolbar/shared/areas/agent';
import { PRODUCT_NAME } from '@toolbar/shared';
import type { Db } from '../db/index.ts';
import { principalFrom } from './access.ts';
import { resourceMetadataUrl } from './oauth.ts';
import { callTool, toolList } from './tools.ts';
import type { McpPrincipal } from './oauth.ts';

type Id = string | number | null;
interface RpcRequest {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

const INSTRUCTIONS = `${PRODUCT_NAME} holds bug captures: video or screenshot of a web page with its console, network, user events and comments. When the user pastes a capture link, call get_capture first and follow its guide: failing requests and errors, then frames at the failure time, then the fix. When you have fixed the bug, leave a create_comment on the capture with the cause and the fix. Ask the user before any delete.`;

const rpcError = (id: Id, code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0' as const, id, error: { code, message, ...(data ? { data } : {}) } });
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });

function negotiate(asked: unknown): string {
  return typeof asked === 'string' && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
}

export async function handleRpc(db: Db, principal: McpPrincipal, msg: RpcRequest): Promise<object | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isNotification ? null : rpcError(id, -32600, 'Invalid request');
  if (isNotification) return null;
  switch (msg.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: negotiate(msg.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: PRODUCT_NAME, version: '0.1.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: toolList(principal.canWrite) });
    case 'tools/call': {
      const name = msg.params?.name;
      if (typeof name !== 'string') return rpcError(id, -32602, 'params.name is required');
      const started = Date.now();
      const res = await callTool({ db, principal }, name, msg.params?.arguments);
      const intent = (msg.params?.arguments as { intent?: unknown } | undefined)?.intent;
      console.log(`[mcp] ${principal.clientName ?? principal.via} ${name} ${res.isError ? 'error' : 'ok'} ${Date.now() - started}ms${typeof intent === 'string' ? ` (${intent.slice(0, 120)})` : ''}`);
      return rpcResult(id, res);
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

function unauthorized(reason: 'missing' | 'invalid' | 'scope'): Response {
  const scope = reason === 'scope';
  const desc =
    reason === 'missing' ? 'Sign in: this server uses OAuth, or send a personal token with an MCP scope.' : scope ? 'This token has no MCP scope.' : 'The token is unknown, expired or revoked.';
  const params = [`resource_metadata="${resourceMetadataUrl()}"`];
  if (reason !== 'missing') params.push(`error="${scope ? 'insufficient_scope' : 'invalid_token'}"`, `error_description="${desc}"`);
  if (scope) params.push('scope="captures:read"');
  return new Response(JSON.stringify({ error: scope ? 'insufficient_scope' : 'unauthorized', message: desc }), {
    status: scope ? 403 : 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer ${params.join(', ')}` },
  });
}

/** POST /mcp */
export async function handleMcpPost(db: Db, request: Request): Promise<Response> {
  const surface = request.headers.get('x-nib-client') === 'cli' ? 'cli' : 'mcp';
  const auth = await principalFrom(db, request.headers.get('authorization'), surface);
  if (!auth.ok) return unauthorized(auth.reason);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcRequest[];
  if (!msgs.length) return Response.json(rpcError(null, -32600, 'Empty batch'), { status: 400 });
  const out: object[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== 'object') {
      out.push(rpcError(null, -32600, 'Invalid request'));
      continue;
    }
    // responses from the client (to server requests we never send) are ignored
    if (!('method' in m)) continue;
    const r = await handleRpc(db, auth.principal, m);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202 });
  const version = request.headers.get('mcp-protocol-version');
  return Response.json(batch ? out : out[0], { headers: version ? { 'mcp-protocol-version': version } : {} });
}

export function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed', message: 'This MCP server is stateless: POST JSON-RPC messages to it.' }), {
    status: 405,
    headers: { allow: 'POST', 'content-type': 'application/json' },
  });
}
