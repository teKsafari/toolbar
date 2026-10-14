// Where the server under test reaches a listener the tests run on this machine.
import { execFileSync } from 'node:child_process';

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';
let cached: string | undefined;

/**
 * The host name the server uses to reach a listener on this machine: 127.0.0.1 for a server on
 * the host (pnpm dev:server), host.docker.internal (compose maps it to the host gateway) when a
 * container publishes the server's port. E2E_CALLBACK_HOST overrides. Listeners bind 0.0.0.0
 * so both work; the browser keeps using 127.0.0.1.
 */
export function callbackHost(): string {
  if (process.env.E2E_CALLBACK_HOST) return process.env.E2E_CALLBACK_HOST;
  if (cached) return cached;
  const port = new URL(SERVER).port || '80';
  cached = '127.0.0.1';
  try {
    if (execFileSync('docker', ['ps', '-q', '--filter', `publish=${port}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) cached = 'host.docker.internal';
  } catch {
    /* no docker */
  }
  return cached;
}
