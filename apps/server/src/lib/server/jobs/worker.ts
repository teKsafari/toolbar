// Worker loop stub. Runs in the server process when WORKER=1 (default). Handlers are
// registered by type; area agents add finalize-recording, transcribe and the rest.
import { hostname } from 'node:os';
import type { JobType } from '@toolbar/shared';
import type { Db } from '../db/index.ts';
import { claim, complete, fail, type JobRow } from './queue.ts';

export type JobHandler = (payload: unknown, job: JobRow) => Promise<void>;

const handlers = new Map<string, { fn: JobHandler; concurrency: number; running: number }>();

export function registerJob(type: JobType, fn: JobHandler, concurrency = 2) {
  handlers.set(type, { fn, concurrency, running: 0 });
}

export interface WorkerHandle {
  stop(): Promise<void>;
  tick(): Promise<number>;
}

export function startWorker(db: Db, { pollMs = 1000, log = console } = {}): WorkerHandle {
  const workerId = `${hostname()}:${process.pid}`;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Set<Promise<void>>();

  async function tick(): Promise<number> {
    let started = 0;
    for (const [type, h] of handlers) {
      const free = h.concurrency - h.running;
      if (free <= 0) continue;
      const jobs = await claim(db, workerId, type, free);
      for (const j of jobs) {
        started++;
        h.running++;
        const p = h
          .fn(j.payload, j)
          .then(() => complete(db, j.id))
          .catch((e: unknown) => {
            log.error(`[jobs] ${type} ${j.id} attempt ${j.attempts} failed:`, e);
            return fail(db, j.id, j.attempts, e instanceof Error ? e.message : String(e));
          })
          .finally(() => {
            h.running--;
            inflight.delete(p);
          });
        inflight.add(p);
      }
    }
    return started;
  }

  async function loop() {
    if (stopped) return;
    try {
      await tick();
    } catch (e) {
      log.error('[jobs] poll failed:', e);
    }
    if (!stopped) timer = setTimeout(loop, pollMs);
  }
  timer = setTimeout(loop, 0);

  return {
    tick,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await Promise.allSettled([...inflight]);
    },
  };
}
