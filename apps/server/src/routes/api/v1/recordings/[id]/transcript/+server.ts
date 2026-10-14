import { eq } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { recordingStream, transcript } from '#lib/server/db/schema/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { createTranscriber, parseVtt } from '#lib/server/transcribe/index.ts';

export const GET = apiRoute(ROUTES['captures.transcript'], async ({ event, params }) => {
  await captureAccess(db, event, params.id, { mode: 'viewer' });
  const [t] = await db.select().from(transcript).where(eq(transcript.recordingId, params.id)).limit(1);
  if (t) {
    return {
      status: t.status,
      language: t.language,
      vtt: t.status === 'done' ? t.vtt : null,
      cues: t.status === 'done' && t.vtt ? parseVtt(t.vtt) : [],
      reason: t.status === 'failed' ? 'failed' : null,
    };
  }
  const streams = await db.select({ name: recordingStream.name }).from(recordingStream).where(eq(recordingStream.recordingId, params.id));
  const reason = !streams.some((s) => s.name === 'voice') ? 'no-voice' : createTranscriber() ? null : 'provider-off';
  return { status: 'none' as const, language: null, vtt: null, cues: [], reason };
});
