// Guards around one transcription: the length cap (TRANSCRIBE_MAX_MINUTES) and, for a hosted
// provider, the monthly minutes cap (TRANSCRIBE_MONTHLY_MINUTES). Usage is reserved before any
// audio is sent, so two jobs at once cannot both pass the cap, then settled to the billed seconds.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import type { TranscribeConfig } from './config.ts';
import type { TranscribeResult, Transcriber } from './index.ts';

export interface UsageLedger {
  /** Add `seconds` to the month unless that passes `capSeconds` (null: no cap). False when refused. */
  reserve(month: string, seconds: number, capSeconds: number | null): Promise<boolean>;
  /** Correct a reservation (positive or negative), never below zero. */
  adjust(month: string, seconds: number): Promise<void>;
  used(month: string): Promise<number>;
}

/** Calendar month in UTC, `YYYY-MM`. */
export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);
const keyOf = (month: string) => `transcribe.usage.${month}`;

/** Usage per month in `instance_setting` rows `transcribe.usage.YYYY-MM` = `{ "seconds": n }`. */
export function dbLedger(db: Db): UsageLedger {
  return {
    async reserve(month, seconds, cap) {
      if (cap !== null && seconds > cap) return false;
      const rows = (await db.execute(sql`
        INSERT INTO instance_setting (key, value) VALUES (${keyOf(month)}, jsonb_build_object('seconds', ${seconds}::numeric))
        ON CONFLICT (key) DO UPDATE
          SET value = jsonb_build_object('seconds', COALESCE((instance_setting.value->>'seconds')::numeric, 0) + ${seconds}::numeric), updated_at = now()
          WHERE ${cap === null} OR COALESCE((instance_setting.value->>'seconds')::numeric, 0) + ${seconds}::numeric <= ${cap ?? 0}::numeric
        RETURNING key`)) as unknown as unknown[];
      return rows.length > 0;
    },
    async adjust(month, seconds) {
      if (!seconds) return;
      await db.execute(sql`
        UPDATE instance_setting
          SET value = jsonb_build_object('seconds', GREATEST(0, COALESCE((value->>'seconds')::numeric, 0) + ${seconds}::numeric)), updated_at = now()
          WHERE key = ${keyOf(month)}`);
    },
    async used(month) {
      const rows = (await db.execute(sql`SELECT (value->>'seconds')::numeric AS s FROM instance_setting WHERE key = ${keyOf(month)}`)) as unknown as { s: string | number }[];
      return Number(rows[0]?.s ?? 0);
    },
  };
}

/** In-memory ledger for tests. */
export function memoryLedger(start: Record<string, number> = {}): UsageLedger & { months: Record<string, number> } {
  const months = { ...start };
  return {
    months,
    async reserve(m, s, cap) {
      const cur = months[m] ?? 0;
      if (cap !== null && cur + s > cap) return false;
      months[m] = cur + s;
      return true;
    },
    async adjust(m, s) {
      months[m] = Math.max(0, (months[m] ?? 0) + s);
    },
    async used(m) {
      return months[m] ?? 0;
    },
  };
}

export type RunOutcome = { status: 'done'; result: TranscribeResult } | { status: 'skipped'; reason: string };

export async function runTranscription(
  t: Transcriber,
  input: { audio: Uint8Array; mime: string; durationMs: number | null; pcm?: Int16Array },
  cfg: Pick<TranscribeConfig, 'maxMinutes' | 'monthlyMinutes'>,
  ledger: UsageLedger,
  now = new Date(),
): Promise<RunOutcome> {
  const seconds = Math.ceil((input.durationMs ?? 0) / 1000);
  if (input.durationMs !== null && seconds > cfg.maxMinutes * 60) {
    return { status: 'skipped', reason: `longer than TRANSCRIBE_MAX_MINUTES (${Math.ceil(seconds / 60)} min > ${cfg.maxMinutes} min)` };
  }
  if (!t.hosted) return { status: 'done', result: await t.transcribe(input) };
  const month = monthOf(now);
  const cap = cfg.monthlyMinutes === null ? null : Math.floor(cfg.monthlyMinutes * 60);
  // unknown length: reserve the per-recording maximum
  const estimate = input.durationMs === null ? Math.ceil(cfg.maxMinutes * 60) : Math.max(1, seconds);
  if (!(await ledger.reserve(month, estimate, cap))) {
    return { status: 'skipped', reason: `monthly limit: TRANSCRIBE_MONTHLY_MINUTES=${cfg.monthlyMinutes} reached for ${month}` };
  }
  try {
    const result = await t.transcribe(input);
    await ledger.adjust(month, result.billedSeconds - estimate);
    return { status: 'done', result };
  } catch (e) {
    // a failed request may still be billed in part; keep the estimate of what a retry will cost off
    await ledger.adjust(month, -estimate);
    throw e;
  }
}
