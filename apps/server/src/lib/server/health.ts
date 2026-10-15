import { sql } from 'drizzle-orm';
import type { Health } from '@toolbar/shared';
import { db } from './db/index.ts';
import { s3Ping } from './s3.ts';
import { whisperPing } from './transcribe/index.ts';
import { env, featureFlags } from './env.ts';

async function timed(fn: () => Promise<unknown>, timeoutMs = 3000) {
  const t = performance.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
    return { ok: true, ms: Math.round(performance.now() - t) };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t), error: e instanceof Error ? e.message || e.name : String(e) };
  }
}

/** db and s3 decide `ok`. whisper is reported but optional: it can take minutes to fetch its model. */
export async function health(version: string): Promise<Health> {
  const [dbCheck, s3Check, whisper] = await Promise.all([
    timed(() => db.execute(sql`select 1`)),
    timed(s3Ping),
    env.transcribe.provider === 'whispercpp' ? timed(() => whisperPing()) : Promise.resolve(null),
  ]);
  const checks: Health['checks'] = { db: dbCheck, s3: s3Check };
  if (whisper) checks.whisper = whisper;
  const features = Object.entries(featureFlags(env))
    .filter(([, on]) => on)
    .map(([k]) => k);
  return { ok: dbCheck.ok && s3Check.ok, version, checks, features };
}
