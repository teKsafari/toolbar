// Starts Xvfb (1460x1000, so the browser's page viewport can be 1440x900) and openbox on
// PARITY_DISPLAY unless an X server owns it already. Stops what it started.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DISPLAY = process.env.PARITY_DISPLAY ?? ':130';
const alive = () => {
  try {
    process.kill(Number(readFileSync(`/tmp/.X${DISPLAY.slice(1)}-lock`, 'utf8').trim()), 0);
    return true;
  } catch {
    return false;
  }
};

export default async function globalSetup() {
  if (DISPLAY === ':99') throw new Error('Display :99 belongs to the shared browser');
  if (alive()) return;
  const started: ChildProcess[] = [spawn('Xvfb', [DISPLAY, '-screen', '0', '1460x1000x24', '-nolisten', 'tcp'], { stdio: 'ignore' })];
  for (let i = 0; i < 50 && !alive(); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  if (!alive()) throw new Error(`Xvfb did not start on ${DISPLAY}`);
  const wm = spawn('openbox', [], { stdio: 'ignore', env: { ...process.env, DISPLAY } });
  wm.on('error', () => undefined);
  started.push(wm);
  await new Promise((r) => setTimeout(r, 700));
  return async () => {
    for (const p of started.reverse()) p.kill();
  };
}
