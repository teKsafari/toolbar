// Where the CLI keeps its sign-in: ~/.config/open-toolbar/config.json (mode 600), or $TOOLBAR_CONFIG.
// TOOLBAR_SERVER and TOOLBAR_TOKEN override the file, so an agent can run without logging in.
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  server: string;
  /** a personal token (tb_pat_) or an OAuth access token (tb_mcp_) */
  token: string;
  via: 'token' | 'oauth';
  refreshToken?: string;
  /** epoch ms when the access token expires (oauth) */
  expiresAt?: number;
  clientId?: string;
  tokenEndpoint?: string;
}

export function configPath(): string {
  if (process.env.TOOLBAR_CONFIG) return process.env.TOOLBAR_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'open-toolbar', 'config.json');
}

export const normServer = (s: string) => s.trim().replace(/\/+$/, '');

export async function readConfig(): Promise<Config | null> {
  const envServer = process.env.TOOLBAR_SERVER;
  const envToken = process.env.TOOLBAR_TOKEN;
  if (envServer && envToken) return { server: normServer(envServer), token: envToken, via: 'token' };
  try {
    const c = JSON.parse(await readFile(configPath(), 'utf8')) as Config;
    if (envServer) c.server = envServer;
    return { ...c, server: normServer(c.server) };
  } catch {
    return null;
  }
}

export async function writeConfig(c: Config): Promise<void> {
  const p = configPath();
  await mkdir(dirname(p), { recursive: true, mode: 0o700 });
  await writeFile(p, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  await chmod(p, 0o600).catch(() => {});
}

export async function clearConfig(): Promise<void> {
  await rm(configPath(), { force: true });
}
