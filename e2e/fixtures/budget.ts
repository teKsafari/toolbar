// Time budgets for checks taken from Jam's measured flows (docs/jam/flows.md).
import os from 'node:os';

/**
 * A budget measured on an idle machine. When the machine is busy (other agents and builds share
 * this VM; the 1-minute load average per core says how busy), it grows in proportion, so the
 * check still catches a real regression without failing on someone else's load.
 */
export function budget(ms: number): number {
  const perCore = os.loadavg()[0]! / Math.max(1, os.cpus().length);
  return Math.round(ms * Math.max(1, 2.5 * perCore));
}
