// The summary a share URL answers to agents (sharePageMarkdown): counts only, built from the
// events without the folder's images and OCR, so it stays fast for a plain fetch.
import { and, count, eq, isNull } from 'drizzle-orm';
import type { EnvInfo } from '@toolbar/shared';
import { sharePageMarkdown, type MaskingPresetName } from '@toolbar/shared/areas/handoff';
import type { Db } from '../db/index.ts';
import { annotation, asset, comment, feedbackResolution } from '../db/schema/index.ts';
import { env } from '../env.ts';
import type { RecordingRow } from '../share/access.ts';
import { loadEvents, preparedOf } from '../mcp/data.ts';
import { deriveSpans } from './spans.ts';

export async function sharePageOf(db: Db, rec: RecordingRow, shareUrl: string, devtools: boolean): Promise<string> {
  const e = (rec.env as EnvInfo | null) ?? null;
  const p = devtools ? await preparedOf(db, rec) : null;
  const events = devtools ? await loadEvents(db, rec) : null;
  const startedAt = rec.startedAt?.getTime();
  const spans = events ? deriveSpans(events, startedAt !== undefined ? { startedAt } : {}) : null;
  const [c] = await db.select({ n: count() }).from(comment).where(and(eq(comment.recordingId, rec.id), isNull(comment.deletedAt)));
  const [a] = await db.select({ n: count() }).from(annotation).where(eq(annotation.recordingId, rec.id));
  const [k] = await db.select({ n: count() }).from(asset).where(and(eq(asset.recordingId, rec.id), eq(asset.kind, 'keyframe')));
  const [r] = await db.select({ at: feedbackResolution.resolvedAt }).from(feedbackResolution).where(eq(feedbackResolution.recordingId, rec.id));
  const http = (p?.network ?? []).filter((n) => n.type !== 'websocket' && n.type !== 'eventsource');
  let app: string | null = rec.pageUrl;
  try {
    if (rec.pageUrl) app = new URL(rec.pageUrl).origin + new URL(rec.pageUrl).pathname;
  } catch {
    /* keep the raw URL */
  }
  return sharePageMarkdown({
    id: rec.id,
    server: env.publicUrl,
    title: rec.title,
    kind: rec.kind,
    createdAt: rec.createdAt.toISOString(),
    durationMs: rec.durationMs,
    reviewer: rec.authorName || rec.authorEmail,
    app,
    browser: e ? `${e.browser ? `${e.browser.name} ${e.browser.version}` : 'browser'}${e.os ? ` on ${e.os.name}` : ''}, ${e.viewport.w}x${e.viewport.h}` : null,
    masking: ((rec as RecordingRow & { maskingPreset?: MaskingPresetName | null }).maskingPreset ?? e?.maskingPreset ?? 'none') as MaskingPresetName,
    resolved: !!r,
    counts: {
      spans: spans?.outcomes ?? null,
      consoleErrors: (p?.console ?? []).filter((x) => (x.kind === 'console' || x.kind === 'error') && x.level === 'error').length,
      failedRequests: http.filter((n) => n.state !== 'done' || (n.status ?? 0) >= 400).length,
      requests: http.length,
      comments: c?.n ?? 0,
      annotations: a?.n ?? 0,
      keyframes: k?.n ?? 0,
    },
    shareUrl,
  });
}
