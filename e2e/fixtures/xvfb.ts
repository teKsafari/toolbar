// A private X display (Xvfb plus openbox) for one test, so nothing else draws on it.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

const alive = (n: number) => {
  try {
    process.kill(Number(readFileSync(`/tmp/.X${n}-lock`, 'utf8').trim()), 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start Xvfb with openbox on the first free display from `from` up (never :99) and return it
 * with a stop function. Chrome's share picker reads every window on its display; with other
 * browsers drawing there it died with X BadWindow on nearly every try (docs/spikes.md S2).
 */
export async function privateDisplay(from: number): Promise<{ display: string; stop(): void }> {
  let n = from;
  while (n === 99 || alive(n)) n++;
  const procs: ChildProcess[] = [spawn('Xvfb', [`:${n}`, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' })];
  for (let i = 0; i < 50 && !alive(n); i++) await sleep(100);
  await sleep(300);
  if (!alive(n)) throw new Error(`Xvfb did not start on :${n}`);
  const wm = spawn('openbox', [], { stdio: 'ignore', env: { ...process.env, DISPLAY: `:${n}` } });
  wm.on('error', () => undefined);
  procs.push(wm);
  await sleep(700);
  return {
    display: `:${n}`,
    stop: () => {
      for (const p of procs.reverse()) p.kill();
    },
  };
}
