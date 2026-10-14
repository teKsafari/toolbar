// Comment reactions for the MCP write tools (J-151). The table `comment_reaction` and the key list
// belong to the viewer area (J-130); this branch reaches the table with plain SQL so it needs no
// schema of its own, and answers `unavailable` while the table is missing (before the merge).
// Merge step: import REACTION_KEYS from '@toolbar/shared/api' and call the viewer's publish().
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { fail } from '../share/http.ts';

/** Same keys, same order as the viewer's REACTION_KEYS (stored and sent by key, no glyphs). */
export const REACTION_KEYS = ['thumbs-up', 'thumbs-down', 'heart', 'laugh', 'party', 'eyes', 'check', 'question'] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

export interface ReactionCount {
  key: ReactionKey;
  count: number;
  mine: boolean;
}

const missingTable = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '42P01' || err?.cause?.code === '42P01';
};

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (missingTable(e)) fail('unavailable', 'Reactions are not enabled on this server yet.');
    throw e;
  }
}

export const actorOf = (userId: string) => `u:${userId}`;

export async function setReaction(db: Db, commentId: string, userId: string, key: ReactionKey, on: boolean): Promise<ReactionCount[]> {
  const actor = actorOf(userId);
  return guarded(async () => {
    if (on) {
      await db.execute(sql`insert into comment_reaction (comment_id, actor, key) values (${commentId}, ${actor}, ${key}) on conflict do nothing`);
    } else {
      await db.execute(sql`delete from comment_reaction where comment_id = ${commentId} and actor = ${actor} and key = ${key}`);
    }
    return reactionsOn(db, commentId, userId);
  });
}

export async function reactionsOn(db: Db, commentId: string, userId: string): Promise<ReactionCount[]> {
  const actor = actorOf(userId);
  return guarded(async () => {
    const res = await db.execute(
      sql`select key, count(*)::int as count, bool_or(actor = ${actor}) as mine, min(created_at) as first from comment_reaction where comment_id = ${commentId} group by key order by first`,
    );
    const rows = ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as { key: string; count: number; mine: boolean }[];
    return rows
      .filter((r): r is { key: ReactionKey; count: number; mine: boolean } => (REACTION_KEYS as readonly string[]).includes(r.key))
      .map((r) => ({ key: r.key, count: Number(r.count), mine: !!r.mine }));
  });
}
