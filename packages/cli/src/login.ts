// `open-toolbar login`: with --token, check a personal token and save it; otherwise sign in through the
// browser with the same OAuth flow MCP agents use (dynamic registration, PKCE, loopback redirect).
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { PRODUCT_NAME } from '@toolbar/shared/constants';
import { normServer, writeConfig, type Config } from './config.ts';
import { CliError } from './client.ts';

const b64url = (b: Buffer) => b.toString('base64url');

export async function loginWithToken(server: string, token: string): Promise<{ name: string; email: string }> {
  const s = normServer(server);
  const res = await fetch(`${s}/api/v1/me`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }).catch((e: Error) => {
    throw new CliError(`Cannot reach ${s}: ${e.message}`);
  });
  if (res.status === 401) throw new CliError('The server does not know this token (wrong, expired or revoked).', 2);
  if (res.status === 403) throw new CliError('This token has no CLI scope. Create one with CLI access under Settings, API tokens.', 2);
  if (!res.ok) throw new CliError(`The server answered ${res.status}.`);
  const me = (await res.json()) as { name: string; email: string };
  await writeConfig({ server: s, token, via: 'token' });
  return me;
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch {
    /* printed URL is the fallback */
  }
}

export async function loginWithBrowser(server: string, opts: { open?: boolean; log: (s: string) => void; timeoutMs?: number }): Promise<Config> {
  const s = normServer(server);
  const meta = (await fetch(`${s}/.well-known/oauth-authorization-server`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string } | null;
  if (!meta) throw new CliError(`${s} does not look like a ${PRODUCT_NAME} server (no OAuth metadata).`);

  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  let finish!: (v: { code: string } | { error: string }) => void;
  const result = new Promise<{ code: string } | { error: string }>((r) => (finish = r));
  const srv = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (u.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>${PRODUCT_NAME} CLI</title><body style="font:15px system-ui;padding:40px">${
        ok ? 'Signed in. You can close this tab and go back to the terminal.' : 'Sign-in was cancelled or failed. Go back to the terminal.'
      }</body>`,
    );
    if (ok) finish({ code: u.searchParams.get('code')! });
    else finish({ error: u.searchParams.get('error_description') ?? u.searchParams.get('error') ?? 'state mismatch' });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const reg = await fetch(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: `${PRODUCT_NAME} CLI on ${hostname()}`, redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
    });
    if (!reg.ok) throw new CliError(`Client registration failed (${reg.status}).`);
    const { client_id } = (await reg.json()) as { client_id: string };

    const auth = new URL(meta.authorization_endpoint);
    auth.search = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      scope: 'captures:read captures:write',
    }).toString();
    opts.log(`Opening your browser to approve the CLI. If nothing opens, visit:\n${auth}`);
    if (opts.open !== false) openBrowser(auth.toString());

    const timer = setTimeout(() => finish({ error: 'timed out waiting for the browser' }), opts.timeoutMs ?? 5 * 60_000);
    const r = await result;
    clearTimeout(timer);
    if ('error' in r) throw new CliError(`Sign-in failed: ${r.error}`, 2);

    const tok = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: r.code, redirect_uri: redirectUri, client_id, code_verifier: verifier }),
    });
    if (!tok.ok) throw new CliError(`Token exchange failed (${tok.status}): ${await tok.text()}`);
    const t = (await tok.json()) as { access_token: string; refresh_token: string; expires_in: number };
    const config: Config = {
      server: s,
      token: t.access_token,
      via: 'oauth',
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      clientId: client_id,
      tokenEndpoint: meta.token_endpoint,
    };
    await writeConfig(config);
    return config;
  } finally {
    srv.close();
  }
}
