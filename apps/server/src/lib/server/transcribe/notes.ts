// Voice notes on comments (Part 2 "What the reviewer can do", D-087): an asset of kind `voice`
// attached to a comment gets its own transcript row, stream `voice:<assetId>`.
import { and, eq, inArray, like } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { transcript } from '../db/schema/index.ts';
import { enqueue } from '../jobs/queue.ts';
import { createTranscriber, voiceNoteStream } from './index.ts';
import { parseVtt } from './vtt.ts';

/** Queue the transcript of a comment's voice note; with transcription off the row says why. */
export async function enqueueVoiceNote(db: Db, recordingId: string, assetId: string) {
  const t = createTranscriber();
  await db
    .insert(transcript)
    .values({
      recordingId,
      stream: voiceNoteStream(assetId),
      provider: t?.id ?? 'none',
      status: t ? 'pending' : 'skipped',
      error: t ? null : 'transcription is off on this server',
    })
    .onConflictDoNothing();
  if (t) await enqueue(db, 'transcribe', { recordingId, assetId });
}

export interface VoiceNoteTranscript {
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  language: string | null;
  text: string | null;
  vtt: string | null;
  reason: string | null;
}

/** Transcripts of the voice notes among `assetIds`, by asset id. */
export async function voiceNoteTranscripts(db: Db, recordingId: string, assetIds: string[]): Promise<Map<string, VoiceNoteTranscript>> {
  const out = new Map<string, VoiceNoteTranscript>();
  if (!assetIds.length) return out;
  const rows = await db
    .select()
    .from(transcript)
    .where(and(eq(transcript.recordingId, recordingId), like(transcript.stream, 'voice:%'), inArray(transcript.stream, assetIds.map(voiceNoteStream))));
  for (const r of rows) {
    const done = r.status === 'done' && r.vtt;
    out.set(r.stream.slice('voice:'.length), {
      status: r.status,
      language: r.language,
      text: done ? parseVtt(r.vtt!).map((c) => c.text).join(' ') : null,
      vtt: done ? r.vtt : null,
      reason: r.status === 'skipped' || r.status === 'failed' ? (r.error ?? r.status) : null,
    });
  }
  return out;
}
