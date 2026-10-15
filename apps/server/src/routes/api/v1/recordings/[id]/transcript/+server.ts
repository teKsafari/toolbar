import { and, eq } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { recordingStream, transcript } from '#lib/server/db/schema/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { createTranscriber, parseVtt, voiceNoteStream } from '#lib/server/transcribe/index.ts';

export const GET = apiRoute(ROUTES['captures.transcript'], async ({ event, params, query }) => {
  await captureAccess(db, event, params.id, { mode: 'viewer' });
  const stream = query.asset ? voiceNoteStream(query.asset) : 'voice';
  const [t] = await db
    .select()
    .from(transcript)
    .where(and(eq(transcript.recordingId, params.id), eq(transcript.stream, stream)))
    .limit(1);
  if (t) {
    return {
      status: t.status,
      language: t.language,
      vtt: t.status === 'done' ? t.vtt : null,
      cues: t.status === 'done' && t.vtt ? parseVtt(t.vtt) : [],
      reason: t.status === 'failed' ? 'failed' : t.status === 'skipped' ? t.error : null,
    };
  }
  if (query.asset) return { status: 'none' as const, language: null, vtt: null, cues: [], reason: 'no-voice' };
  const streams = await db.select({ name: recordingStream.name }).from(recordingStream).where(eq(recordingStream.recordingId, params.id));
  const reason = !streams.some((s) => s.name === 'voice') ? 'no-voice' : createTranscriber() ? null : 'provider-off';
  return { status: 'none' as const, language: null, vtt: null, cues: [], reason };
});
