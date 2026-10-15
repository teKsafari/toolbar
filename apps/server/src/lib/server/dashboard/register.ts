// Wires the dashboard area into the server process: job handlers (webhook deliveries,
// auto-delete), the capture notice sweep and the integration destination for finalize (J-137). hooks.server.ts
// imports this module once.
import { db } from '../db/index.ts';
import { env } from '../env.ts';
import { registerJob } from '../jobs/worker.ts';
import { setDestinationHandler } from '../upload/service.ts';
import { destinationHandler } from '../integrations/index.ts';
import { attempt } from '../webhooks/index.ts';
import { autoDelete, baselineNotices, ensureDashboardJobs, NOTICE_EVERY_MS, scheduleNext, sweepNotices } from './notices.ts';

let done = false;

export function registerDashboard() {
  if (done) return;
  done = true;
  setDestinationHandler((d, rec, destination, shareUrl) => destinationHandler(d, rec, destination, shareUrl));
  if (!env.worker) return;
  registerJob(
    'webhook-deliver',
    async (payload) => {
      const id = (payload as { deliveryId?: string })?.deliveryId;
      if (id) await attempt(db, id);
    },
    4,
  );
  registerJob(
    'auto-delete',
    async () => {
      try {
        // retention is paused (FEATURE_ADMIN_EXTRAS off): a limit set earlier deletes nothing
        if (env.features.adminExtras) await autoDelete(db);
      } finally {
        await scheduleNext(db, 'auto-delete', 60 * 60_000);
      }
    },
    1,
  );
  void (async () => {
    await baselineNotices(db);
    await ensureDashboardJobs(db);
    // Capture notices: a light poll; the claim in sweepNotices keeps several processes from double-sending.
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      sweepNotices(db)
        .catch((e) => console.warn('[dashboard] notice sweep failed:', e instanceof Error ? e.message : e))
        .finally(() => (busy = false));
    }, NOTICE_EVERY_MS);
    timer.unref?.();
  })().catch((e) => console.error('[dashboard] job setup failed:', e));
}
