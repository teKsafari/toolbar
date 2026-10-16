// Feedback items of the in-page reviewer toolbar (work package p4/reviewer-ui, table
// `feedback_item`): the pins, highlights, drawings, element screenshots and voice notes a reviewer
// leaves on the live page. The folder writes them as annotations/aNN.*, and resolving can close
// them one by one. Read with plain SQL so the folder works with or without that table.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';

export interface ItemRow {
  id: string;
  n: number;
  kind: string;
  comment: string;
  quote: string | null;
  target: Record<string, unknown> | null;
  locator: Record<string, unknown> | null;
  shapes: Record<string, unknown>[];
  cropAssetId: string | null;
  cropRect: { x: number; y: number; w: number; h: number } | null;
  voiceAssetId: string | null;
  transcriptStatus: string | null;
  transcriptText: string | null;
  transcriptVtt: string | null;
  transcriptLanguage: string | null;
  voiceDurationMs: number | null;
  context: Record<string, unknown> | null;
  page: { url?: string; title?: string; viewport?: { w: number; h: number }; scroll?: { x: number; y: number }; dpr?: number } | null;
  intent: string;
  severity: string;
  status: string;
  t: number;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date;
}

const present = new WeakSet<object>();

/** Whether this database has the reviewer toolbar's table (a yes is remembered per connection). */
export async function hasItemsTable(db: Db): Promise<boolean> {
  if (present.has(db)) return true;
  const rows = (await db.execute(sql`select to_regclass('public.feedback_item') is not null as ok`)) as unknown as { ok: boolean }[];
  if (rows[0]?.ok) present.add(db);
  return !!rows[0]?.ok;
}

const json = <T>(v: unknown): T | null => (v == null ? null : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

export async function feedbackItemsOf(db: Db, recordingId: string): Promise<ItemRow[]> {
  if (!(await hasItemsTable(db))) return [];
  const rows = (await db.execute(sql`select * from feedback_item where recording_id = ${recordingId} order by n, created_at`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    n: Number(r.n),
    kind: String(r.kind),
    comment: String(r.comment ?? ''),
    quote: (r.quote as string | null) ?? null,
    target: json(r.target),
    locator: json(r.locator),
    shapes: json<Record<string, unknown>[]>(r.shapes) ?? [],
    cropAssetId: (r.crop_asset_id as string | null) ?? null,
    cropRect: json(r.crop_rect),
    voiceAssetId: (r.voice_asset_id as string | null) ?? null,
    transcriptStatus: (r.transcript_status as string | null) ?? null,
    transcriptText: (r.transcript_text as string | null) ?? null,
    transcriptVtt: (r.transcript_vtt as string | null) ?? null,
    transcriptLanguage: (r.transcript_language as string | null) ?? null,
    voiceDurationMs: r.voice_duration_ms == null ? null : Number(r.voice_duration_ms),
    context: json(r.context),
    page: json(r.page),
    intent: String(r.intent ?? 'fix'),
    severity: String(r.severity ?? 'important'),
    status: String(r.status ?? 'pending'),
    t: Number(r.t),
    authorName: (r.author_name as string | null) ?? null,
    authorEmail: (r.author_email as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
  }));
}

/**
 * Mark items resolved by pin number (all open ones when `ns` is null). Returns the numbers it
 * changed and how many items stay open (pending or acknowledged).
 */
export async function resolveItems(db: Db, recordingId: string, ns: number[] | null): Promise<{ resolved: number[]; open: number }> {
  if (!(await hasItemsTable(db))) return { resolved: [], open: 0 };
  const changed = (await (ns && !ns.length
    ? Promise.resolve([])
    : ns
    ? db.execute(sql`update feedback_item set status = 'resolved' where recording_id = ${recordingId} and status in ('pending', 'acknowledged') and n in (${sql.join(ns.map((n) => sql`${n}`), sql`, `)}) returning n`)
    : db.execute(sql`update feedback_item set status = 'resolved' where recording_id = ${recordingId} and status in ('pending', 'acknowledged') returning n`))) as unknown as { n: number }[];
  const open = (await db.execute(sql`select count(*)::int as c from feedback_item where recording_id = ${recordingId} and status in ('pending', 'acknowledged')`)) as unknown as { c: number }[];
  return { resolved: changed.map((r) => Number(r.n)).sort((a, b) => a - b), open: Number(open[0]?.c ?? 0) };
}

/**
 * Open the resolved items of a capture again, as reopening the feedback does: a pin closed by the
 * resolution would otherwise stay closed on an open capture, and the next agent's README would
 * read "resolved" under every note.
 */
export async function reopenItems(db: Db, recordingId: string): Promise<number> {
  if (!(await hasItemsTable(db))) return 0;
  const rows = (await db.execute(sql`update feedback_item set status = 'pending' where recording_id = ${recordingId} and status = 'resolved' returning n`)) as unknown as { n: number }[];
  return rows.length;
}
