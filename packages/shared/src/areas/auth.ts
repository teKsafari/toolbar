// Shared types and constants the auth area adds (import from '@toolbar/shared/areas/auth').
// Only the auth area edits this file.
import type { WorkspaceSettings } from '../api/workspaces.ts';
import type { TokenScope } from '../api/account.ts';
import type { HttpMethod } from '../api/common.ts';

/** Settings a workspace has before an admin changes anything (J-120, J-125, J-156, J-173, J-178, J-222). */
export const DEFAULT_WORKSPACE_SETTINGS: Omit<WorkspaceSettings, 'name' | 'logoUrl'> = {
  defaultLinkAccess: 'anyone',
  domainJoin: { enabled: false, domain: null },
  aiEnabled: true,
  autoDeleteDays: null,
  inviteLinkEnabled: true,
  restrictInvites: false,
  autoApproveCreators: true,
};

/** Webmail domains never used for join-by-domain (J-125): anyone can get an address there. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'fastmail.com', 'hey.com', 'tutanota.com', 'qq.com', '163.com',
]);

/** The domain part of an address, lower case; null for a public webmail domain or a malformed address. */
export function joinableDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  if (!d.includes('.') || PUBLIC_EMAIL_DOMAINS.has(d)) return null;
  return d;
}

/** Invite links and email invites expire after these many days (J-173: about 29 days). */
export const INVITE_LINK_DAYS = 29;
export const INVITE_EMAIL_DAYS = 14;
/** Extension sign-in code lifetime (architecture s9). */
export const EXT_CODE_TTL_MS = 60_000;

/** The surface a personal token is used on: REST calls from the CLI, or the MCP endpoint. */
export type TokenSurface = 'cli' | 'mcp';

/**
 * Scope a route needs from a personal token: the route's own `scope`, else read for GET and
 * write for anything else.
 */
export function neededScope(route: { method: HttpMethod; scope?: 'read' | 'write' }): 'read' | 'write' {
  return route.scope ?? (route.method === 'GET' ? 'read' : 'write');
}

/** True when the token's scopes allow `need` on `surface`; write implies read. */
export function tokenAllows(scopes: readonly string[], surface: TokenSurface, need: 'read' | 'write'): boolean {
  if (scopes.includes(`${surface}:write` satisfies `${TokenSurface}:${string}`)) return true;
  return need === 'read' && scopes.includes(`${surface}:read`);
}

/**
 * Labels for the token dialog (J-148): read-only or read-write per surface. The `cli:*` scopes
 * gate the HTTP API (the paused CLI calls it too, D-070), so the dialog names them after the API.
 */
export const TOKEN_SCOPE_LABELS: Record<TokenScope, string> = {
  'cli:read': 'HTTP API, read only',
  'cli:write': 'HTTP API, read and write',
  'mcp:read': 'MCP, read only',
  'mcp:write': 'MCP, read and write',
};

// ---------- PKCE (RFC 7636), used by the extension and by the server tests ----------

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Random URL-safe string from `bytes` random bytes (32 bytes gives 43 characters). */
export function randomUrlToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlToken(48);
  return { verifier, challenge: await pkceChallenge(verifier) };
}

/** The launchWebAuthFlow redirect URL Chrome gives an extension id (chrome.identity.getRedirectURL('cb')). */
export const extRedirectUri = (extensionId: string) => `https://${extensionId}.chromiumapp.org/cb`;

/** Extension id of an allowed redirect URI, or null. Only https://<id>.chromiumapp.org/cb is accepted. */
export function extensionIdOfRedirect(uri: string): string | null {
  const m = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/cb$/.exec(uri);
  return m ? m[1]! : null;
}
