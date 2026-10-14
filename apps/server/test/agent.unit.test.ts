// Agent area units: markdown negotiation, OAuth helpers, the MCP JSON-RPC layer and tool list.
import { describe, expect, it } from 'vitest';
import { wantsMarkdown } from '../src/lib/server/mcp/markdown.ts';
import { parseScopes, redirectWith, registerSchema, authServerMetadata, protectedResourceMetadata } from '../src/lib/server/mcp/oauth.ts';
import { handleRpc } from '../src/lib/server/mcp/protocol.ts';
import { TOOLS, toolList, callTool } from '../src/lib/server/mcp/tools.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import type { McpPrincipal } from '../src/lib/server/mcp/oauth.ts';

const principal = (canWrite: boolean): McpPrincipal => ({ userId: '019a0000-0000-7000-8000-000000000001', workspaceId: null, canWrite, via: 'personal', grantId: null, clientName: null });
const noDb = {} as Db;

describe('markdown negotiation (J-153)', () => {
  it('serves markdown only when asked ahead of HTML', () => {
    expect(wantsMarkdown('text/markdown')).toBe(true);
    expect(wantsMarkdown('text/markdown, text/html;q=0.5')).toBe(true);
    expect(wantsMarkdown('text/html, text/markdown;q=0.9')).toBe(false);
    expect(wantsMarkdown('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(false);
    expect(wantsMarkdown('*/*')).toBe(false);
    expect(wantsMarkdown(null)).toBe(false);
  });
});

describe('OAuth helpers (J-146)', () => {
  it('asks for both scopes by default and drops unknown ones', () => {
    expect(parseScopes(undefined)).toEqual(['captures:read', 'captures:write']);
    expect(parseScopes('captures:read openid')).toEqual(['captures:read']);
  });

  it('accepts https, loopback http and app schemes as redirect URIs', () => {
    const ok = (u: string) => registerSchema.safeParse({ redirect_uris: [u] }).success;
    expect(ok('https://agent.example/cb')).toBe(true);
    expect(ok('http://127.0.0.1:33418/callback')).toBe(true);
    expect(ok('http://localhost:6274/oauth/callback')).toBe(true);
    expect(ok('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe(true);
    expect(ok('http://evil.example/cb')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('https://a.example/cb#frag')).toBe(false);
  });

  it('adds parameters to redirects and advertises PKCE S256', () => {
    expect(redirectWith('http://127.0.0.1:9/cb?x=1', { code: 'c', state: 's', no: undefined })).toBe('http://127.0.0.1:9/cb?x=1&code=c&state=s');
    expect(authServerMetadata().code_challenge_methods_supported).toEqual(['S256']);
    expect(protectedResourceMetadata().resource).toMatch(/\/mcp$/);
  });
});

describe('MCP protocol (J-149 to J-151)', () => {
  it('initializes with a supported protocol version', async () => {
    const r = (await handleRpc(noDb, principal(true), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })) as { result: { protocolVersion: string; capabilities: object } };
    expect(r.result.protocolVersion).toBe('2025-06-18');
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
    const old = (await handleRpc(noDb, principal(true), { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })) as { result: { protocolVersion: string } };
    expect(old.result.protocolVersion).toBe('2025-11-25');
  });

  it('ignores notifications and rejects unknown methods', async () => {
    expect(await handleRpc(noDb, principal(true), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const r = (await handleRpc(noDb, principal(true), { jsonrpc: '2.0', id: 3, method: 'nope' })) as { error: { code: number } };
    expect(r.error.code).toBe(-32601);
  });

  it('lists tools with schemas, titles, annotations and an intent field; hides writes when read-only', () => {
    const all = toolList(true);
    expect(all.length).toBe(TOOLS.length);
    for (const t of all) {
      expect(t.inputSchema.type).toBe('object');
      expect((t.inputSchema.properties as Record<string, unknown>).intent).toBeDefined();
      expect(t.annotations.title).toBe(t.title);
      expect(typeof t.annotations.readOnlyHint).toBe('boolean');
    }
    const names = all.map((t) => t.name);
    for (const n of ['get_capture', 'get_console_logs', 'get_network_requests', 'get_user_events', 'get_metadata', 'get_screenshots', 'get_frames', 'get_transcript', 'get_chapters', 'search', 'search_captures', 'list_captures', 'list_folders', 'list_members', 'create_comment', 'update_capture', 'delete_comment'])
      expect(names).toContain(n);
    const ro = toolList(false).map((t) => t.name);
    expect(ro).not.toContain('create_comment');
    expect(ro).toContain('get_capture');
    expect(TOOLS.find((t) => t.name === 'delete_capture')!.annotations.destructiveHint).toBe(true);
  });

  it('refuses a write tool on a read-only connection and reports bad arguments', async () => {
    const w = await callTool({ db: noDb, principal: principal(false) }, 'create_comment', { capture: 'x', body: 'hi' });
    expect(w.isError).toBe(true);
    expect((w.content[0] as { text: string }).text).toMatch(/read-only/);
    const bad = await callTool({ db: noDb, principal: principal(true) }, 'get_frames', { capture: 'x', size: '999' });
    expect(bad.isError).toBe(true);
    expect((bad.content[0] as { text: string }).text).toMatch(/Invalid arguments: size/);
  });
});
