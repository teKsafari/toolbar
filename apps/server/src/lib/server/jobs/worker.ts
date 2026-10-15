// Job worker (D-010, X-02). Runs in the server process when WORKER=1 (default). Handlers register
// by type (handlers.ts registers the server-core set on start). Jobs are claimed with
// FOR UPDATE SKIP LOCKED under a lease that a heartbeat extends while the handler runs. On start,
// leases held by an earlier process on this host are released, so a job interrupted by a crash or
// restart runs again at once instead of after the lease runs out.
import { hostname } from 'node:os';
import { sql } from 'drizzle-orm';
import type { JobType } from '@toolbar/shared';
import type { Db } from '../db/index.ts';
import { claim, complete, fail, type JobRow } from './queue.ts';

export type JobHandler = (payload: unknown, job: JobRow) => Promise<void>;

const handlers = new Map<string, { fn: JobHandler; concurrency: number; running: number }>();

export function registerJob(type: JobType, fn: JobHandler, concurrency = 2) {
  handlers.set(type, { fn, concurrency, running: 0 });
}

export function registeredJobTypes() {
  return [...handlers.keys()];
}

export interface WorkerHandle {
  stop(): Promise<void>;
  tick(): Promise<number>;
  ready: Promise<void>;
}

export const LEASE_MS = 2 * 60_000;
const HEARTBEAT_MS = 30_000;

/** Release leases that earlier processes on this host still hold (they are dead: pids differ). */
export async function releaseStaleLocks(db: Db, workerId: string) {
  const host = workerId.slice(0, workerId.lastIndexOf(':'));
  const rows = await db.execute(sql`
    UPDATE job SET locked_until = NULL, locked_by = NULL
    WHERE done_at IS NULL AND locked_until > now() AND locked_by LIKE ${host + ':%'} AND locked_by <> ${workerId}
    RETURNING id`);
  return (rows as unknown as unknown[]).length;
}

export function startWorker(db: Db, { pollMs = 1000, log = console, registerDefaults = true } = {}): WorkerHandle {
  const workerId = `${hostname()}:${process.pid}`;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Set<Promise<void>>();

  async function tick(): Promise<number> {
    let started = 0;
    for (const [type, h] of handlers) {
      const free = h.concurrency - h.running;
      if (free <= 0) continue;
      const jobs = await claim(db, workerId, type, free, LEASE_MS);
      for (const j of jobs) {
        started++;
        h.running++;
        const beat = setInterval(() => {
          void db
            .execute(sql`UPDATE job SET locked_until = now() + (${LEASE_MS} * interval '1 millisecond') WHERE id = ${j.id} AND locked_by = ${workerId}`)
            .catch(() => {});
        }, HEARTBEAT_MS);
        const p = Promise.resolve()
          .then(() => h.fn(j.payload, j))
          .then(() => complete(db, j.id))
          .catch((e: unknown) => {
            log.error(`[jobs] ${type} ${j.id} attempt ${j.attempts} failed:`, e instanceof Error ? e.message : e);
            return fail(db, j.id, j.attempts, e instanceof Error ? e.message : String(e), (e as { retryInMs?: number }).retryInMs);
          })
          .finally(() => {
            clearInterval(beat);
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

  const ready = (async () => {
    if (registerDefaults) {
      const { registerServerCoreJobs, ensureRecurringJobs } = await import('./handlers.ts');
      registerServerCoreJobs();
      (await import('../feedback/service.ts')).registerFeedbackJobs();
      await ensureRecurringJobs(db).catch((e) => log.error('[jobs] recurring jobs:', e));
    }
    const n = await releaseStaleLocks(db, workerId).catch(() => 0);
    if (n) log.log(`[jobs] released ${n} job lease(s) left by an earlier process`);
  })();
  void ready.finally(() => {
    if (!stopped) timer = setTimeout(loop, 0);
  });

  return {
    tick,
    ready,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await Promise.allSettled([...inflight]);
    },
  };
}

/** Throw from a handler to retry after a set delay instead of the backoff. */
export class RetryLater extends Error {
  readonly retryInMs: number;
  constructor(message: string, retryInMs: number) {
    super(message);
    this.retryInMs = retryInMs;
  }
}
