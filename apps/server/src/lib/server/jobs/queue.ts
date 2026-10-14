// Postgres job queue (D-010). Claim with FOR UPDATE SKIP LOCKED, lease with locked_until,
// retry with exponential backoff, keep finished rows (done_at) for inspection.
import { sql } from 'drizzle-orm';
import type { JobType } from '@toolbar/shared';
import type { Db } from '../db/index.ts';
import { job } from '../db/schema/index.ts';

export interface JobRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

export async function enqueue(db: Db, type: JobType, payload: unknown = {}, opts: { runAt?: Date; maxAttempts?: number } = {}) {
  const [row] = await db
    .insert(job)
    .values({ type, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 })
    .returning({ id: job.id });
  return row!.id;
}

/** Claims up to `limit` due jobs of one type for `leaseMs`. */
export async function claim(db: Db, workerId: string, type: string, limit = 1, leaseMs = 5 * 60_000): Promise<JobRow[]> {
  const rows = await db.execute(sql`
    UPDATE job SET locked_until = now() + (${leaseMs} * interval '1 millisecond'), locked_by = ${workerId}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM job
      WHERE done_at IS NULL AND run_at <= now() AND (locked_until IS NULL OR locked_until < now())
        AND attempts < max_attempts AND type = ${type}
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts`);
  return rows as unknown as JobRow[];
}

export async function complete(db: Db, id: string) {
  await db.execute(sql`UPDATE job SET done_at = now(), locked_until = NULL, last_error = NULL WHERE id = ${id}`);
}

/** Backoff: 2^attempts seconds, capped at 1 hour, unless the handler asked for a set delay. */
export async function fail(db: Db, id: string, attempts: number, error: string, retryInMs?: number) {
  const delayS = retryInMs !== undefined ? retryInMs / 1000 : Math.min(3600, 2 ** attempts);
  await db.execute(sql`
    UPDATE job SET locked_until = NULL, last_error = ${error.slice(0, 4000)},
      run_at = now() + (${delayS} * interval '1 second')
    WHERE id = ${id}`);
}
