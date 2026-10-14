// Routes the agent area adds beyond the base contract. Only the agent area edits this file.
// routes.ts spreads this list into ROUTE_LIST.
import { z } from 'zod';
import { api, defineRoute, idSchema } from '../common.ts';

export const agentPromptsSchema = z.object({ setup: z.string(), fix: z.string(), summarize: z.string(), e2e: z.string() });

export const captureBriefSchema = z.object({
  /** link to put in prompts: the share URL for link viewers, the member URL otherwise */
  captureUrl: z.string(),
  mcpUrl: z.string(),
  /** the caller has at least one connected MCP agent (J-152 switches from setup to presets) */
  connected: z.boolean(),
  prompts: agentPromptsSchema,
  /** copy-for-AI text: summary, errors, failed requests and steps as markdown */
  markdown: z.string(),
});
export type AgentBrief = z.infer<typeof captureBriefSchema>;

export const captureBrief = defineRoute({
  name: 'agent.captureBrief',
  method: 'GET',
  path: api('/mcp/captures/:id/brief'),
  auth: 'viewer',
  scope: 'read',
  params: z.object({ id: idSchema }),
  response: captureBriefSchema,
  area: 'agent',
  tasks: ['J-152'],
  summary: 'Agent tab data: setup prompt or the fix, summarise and E2E presets with the capture URL, plus the copy-for-AI markdown.',
});

const oauthForm = z.record(z.string(), z.string());

export const mcpRegister = defineRoute({
  name: 'agent.oauthRegister',
  method: 'POST',
  path: '/mcp/register',
  auth: 'public',
  body: z.object({ redirect_uris: z.array(z.string()).min(1), client_name: z.string().optional(), token_endpoint_auth_method: z.string().optional() }).loose(),
  response: z.object({ client_id: z.string(), client_secret: z.string().optional(), client_name: z.string(), redirect_uris: z.array(z.string()) }).loose(),
  area: 'agent',
  tasks: ['J-146'],
  summary: 'OAuth dynamic client registration (RFC 7591) for MCP clients.',
});

export const mcpAuthorize = defineRoute({
  name: 'agent.oauthAuthorize',
  method: 'GET',
  path: '/mcp/authorize',
  auth: 'session',
  query: z.object({ client_id: z.string(), redirect_uri: z.string().optional(), code_challenge: z.string(), code_challenge_method: z.literal('S256'), state: z.string().optional(), scope: z.string().optional() }).loose(),
  response: 'html',
  area: 'agent',
  tasks: ['J-146'],
  summary: 'Consent page: workspace picker, client name, the two scopes, approve. Redirects to the client with ?code&state&iss.',
});

export const mcpTokenRoute = defineRoute({
  name: 'agent.oauthToken',
  method: 'POST',
  path: '/mcp/token',
  auth: 'public',
  body: oauthForm,
  response: z.object({ access_token: z.string(), token_type: z.literal('Bearer'), expires_in: z.number(), refresh_token: z.string(), scope: z.string() }),
  status: 200,
  area: 'agent',
  tasks: ['J-146'],
  summary: 'Form-encoded token endpoint: authorization_code with PKCE S256, refresh_token with rotation.',
});

export const mcpRevokeRoute = defineRoute({
  name: 'agent.oauthRevoke',
  method: 'POST',
  path: '/mcp/revoke',
  auth: 'public',
  body: oauthForm,
  status: 200,
  area: 'agent',
  tasks: ['J-147'],
  summary: 'Token revocation (RFC 7009).',
});

export const oauthServerMetadata = defineRoute({
  name: 'agent.oauthMetadata',
  method: 'GET',
  path: '/.well-known/oauth-authorization-server',
  auth: 'public',
  response: z.record(z.string(), z.unknown()),
  area: 'agent',
  tasks: ['J-146'],
  summary: 'Authorization server metadata (RFC 8414); also served under a /mcp suffix.',
});

export const protectedResourceMetadata = defineRoute({
  name: 'agent.resourceMetadata',
  method: 'GET',
  path: '/.well-known/oauth-protected-resource',
  auth: 'public',
  response: z.record(z.string(), z.unknown()),
  area: 'agent',
  tasks: ['J-146'],
  summary: 'Protected resource metadata (RFC 9728) for /mcp; also served under a /mcp suffix.',
});

export const agentAreaRoutes = [captureBrief, mcpRegister, mcpAuthorize, mcpTokenRoute, mcpRevokeRoute, oauthServerMetadata, protectedResourceMetadata] as const;
