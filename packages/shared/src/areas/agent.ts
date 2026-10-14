// Shared types and constants the agent area adds (import from '@toolbar/shared/areas/agent').
// Only the agent area edits this file.
import { PRODUCT_NAME, PRODUCT_SLUG } from '../constants.ts';

/** OAuth scopes an MCP client can ask for (J-146): read, and comment and organise. */
export const MCP_SCOPES = ['captures:read', 'captures:write'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  'captures:read': 'See captures in this workspace, with their console, network, user events, frames, transcripts and comments',
  'captures:write': 'Comment on captures, rename them, and move them between folders',
};

/** Prefixes of MCP OAuth tokens and client ids, recognisable by secret scanners. */
export const MCP_TOKEN_PREFIX = { access: 'tb_mcp_', refresh: 'tb_mcr_' } as const;
export const MCP_CLIENT_PREFIX = 'nbc_';

/** Lifetimes: access tokens one day, refresh tokens 90 days, authorization codes one minute. */
export const MCP_TTL = { accessMs: 24 * 3600_000, refreshMs: 90 * 24 * 3600_000, codeMs: 60_000 } as const;

/** MCP protocol versions the server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

/** Name the server registers under in agent configs. */
export const MCP_SERVER_NAME = PRODUCT_SLUG;

/** The CLI binary (packages/cli). */
export const CLI_BIN = PRODUCT_SLUG;

export type AgentClientId = 'claude-code' | 'cursor' | 'codex' | 'vscode' | 'other';

export interface AgentSetup {
  id: AgentClientId;
  name: string;
  /** What to paste, with only the server URL in it (J-145). */
  snippet: string;
  /** Language of the snippet, for display. */
  lang: 'shell' | 'json' | 'toml';
  steps: string[];
}

/** Setup cards for the MCP settings page (J-145). Each snippet holds only the server URL. */
export function agentSetups(mcpUrl: string): AgentSetup[] {
  const name = MCP_SERVER_NAME;
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      lang: 'shell',
      snippet: `claude mcp add --transport http ${name} ${mcpUrl}`,
      steps: ['Run the command in a terminal.', 'Start Claude Code and run /mcp, then pick the server to sign in.', `Approve the request in the browser page that opens.`],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      lang: 'json',
      snippet: JSON.stringify({ mcpServers: { [name]: { url: mcpUrl } } }, null, 2),
      steps: ['Open Cursor settings, then MCP, then add a new global server.', 'Paste the JSON into mcp.json and save.', 'Click the sign-in prompt next to the server and approve in the browser.'],
    },
    {
      id: 'codex',
      name: 'Codex',
      lang: 'shell',
      snippet: `codex mcp add ${name} --url ${mcpUrl}`,
      steps: ['Run the command in a terminal.', `Run \`codex mcp login ${name}\` and approve in the browser.`],
    },
    {
      id: 'vscode',
      name: 'VS Code',
      lang: 'json',
      snippet: JSON.stringify({ servers: { [name]: { type: 'http', url: mcpUrl } } }, null, 2),
      steps: ['Run "MCP: Open User Configuration" from the command palette.', 'Paste the JSON and save.', 'Start the server from the editor and approve in the browser.'],
    },
    {
      id: 'other',
      name: 'Other agents',
      lang: 'shell',
      snippet: mcpUrl,
      steps: [
        'Add a remote MCP server of type streamable HTTP with this URL.',
        'The server signs agents in with OAuth (dynamic client registration and PKCE).',
        `Agents without OAuth can send a personal token with an MCP scope as "Authorization: Bearer <token>" (Settings, API tokens).`,
      ],
    },
  ];
}

/** The skill file the CLI installs for coding agents (J-155, J-247): which reads to make first. */
export function agentSkill(cli: string = CLI_BIN): string {
  return `---
name: ${PRODUCT_SLUG}-captures
description: Read ${PRODUCT_NAME} bug captures (console, network, user events, video frames) with the ${cli} CLI and fix the bug they show. Use when the user pastes a ${PRODUCT_NAME} capture link or asks about a captured bug.
---

# Working from a ${PRODUCT_NAME} capture

A capture link looks like \`<server>/c/<id>\` or \`<server>/s/<token>\`. Every command takes either form.

Read in this order:

1. \`${cli} get <link>\`: title, page, environment, signal counts and a guide to the next calls.
2. \`${cli} network <link> --status 4xx,5xx,failed\` and \`${cli} console <link> --level error\`: failing requests with their response bodies, uncaught errors with stacks.
3. \`${cli} frames <link> --at <ms>\`: the screen at the time of the first failure (JPG files in ./${PRODUCT_SLUG}-<id>/frames). Use \`--overview\` for a 4x3 grid.
4. \`${cli} actions <link>\`: what the person clicked and typed before it failed.
5. Fix the bug in the code.
6. \`${cli} comment <link> "<cause and fix>"\`: tell the reporter what you changed.

Output is JSON pages: \`{ items, total, returned, hasMore, nextCursor }\`. Pass \`--cursor <nextCursor>\` for the next page.
\`${cli} pull <link>\` writes everything (details, console, network, actions, events, frames, screenshots) to a folder for agents that read files.
`;
}
