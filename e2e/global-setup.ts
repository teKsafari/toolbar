// Starts a private Xvfb (plus openbox; Chromium's screen picker needs a window manager,
// see docs/spikes.md S2) unless one already answers on E2E_DISPLAY. Stops what it started.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DISPLAY } from './fixtures/extension.ts';

/** An X server owns the display when its lock file names a live process. */
const alive = () => {
  try {
    const pid = Number(readFileSync(`/tmp/.X${DISPLAY.slice(1)}-lock`, 'utf8').trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export default async function globalSetup() {
  if (DISPLAY === ':99') throw new Error('Display :99 belongs to the shared browser; pick another E2E_DISPLAY');
  if (alive()) return;
  const started: ChildProcess[] = [];
  started.push(spawn('Xvfb', [DISPLAY, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' }));
  for (let i = 0; i < 50 && !alive(); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300)); // lock file appears just before the socket accepts
  if (!alive()) throw new Error(`Xvfb did not start on ${DISPLAY}`);
  try {
    started.push(spawn('openbox', [], { stdio: 'ignore', env: { ...process.env, DISPLAY } }));
  } catch {
    /* openbox is optional for the smoke test */
  }
  return async () => {
    for (const p of started.reverse()) p.kill();
  };
}
