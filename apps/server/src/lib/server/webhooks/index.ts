// Signed outgoing webhooks (J-142, D-030). Each event becomes one delivery row per subscribed
// endpoint; a `webhook-deliver` job posts it and reschedules failures with backoff. Signature:
// `x-nib-signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { uuidv7 } from '@toolbar/shared';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookEvent,
  type WebhookPayload,
} from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { webhook, webhookDelivery } from '../db/schema/index.ts';
import { seal, unseal } from '../crypto.ts';
import { enqueue } from '../jobs/queue.ts';
import { fail } from '../share/http.ts';

type HookRow = typeof webhook.$inferSelect;
type DeliveryRow = typeof webhookDelivery.$inferSelect;

/** Seconds until the next attempt after attempt n (1-based); 8 attempts span about a day. */
export const RETRY_DELAYS_S = [10, 60, 5 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600];
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Receiver-side check, exported for tests and for anyone writing a receiver in Node. */
export function verify(secret: string, body: string, header: string, toleranceS = 300, now = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceS || !parts.v1) return false;
  const want = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const got = Buffer.from(parts.v1, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export async function toHooks(db: Db, rows: HookRow[]) {
  const out = [];
  for (const h of rows) {
    const [last] = await db
      .select()
      .from(webhookDelivery)
      .where(and(eq(webhookDelivery.webhookId, h.id), sql`${webhookDelivery.lastAttemptAt} IS NOT NULL`))
      .orderBy(desc(webhookDelivery.lastAttemptAt))
      .limit(1);
    out.push({
      id: h.id,
      workspaceId: h.organizationId,
      url: h.url,
      events: h.events as WebhookEvent[],
      active: h.active,
      createdAt: h.createdAt.toISOString(),
      lastDelivery: last ? { at: last.lastAttemptAt!.toISOString(), ok: last.status === 'ok', status: last.responseStatus } : null,
    });
  }
  return out;
}

export async function listHooks(db: Db, workspaceId: string) {
  return toHooks(db, await db.select().from(webhook).where(eq(webhook.organizationId, workspaceId)).orderBy(webhook.createdAt));
}

export async function createHook(db: Db, workspaceId: string, userId: string, body: { url: string; events: WebhookEvent[] }) {
  const secret = newSecret();
  const [h] = await db
    .insert(webhook)
    .values({ organizationId: workspaceId, url: body.url, events: body.events, secretEnc: seal(secret, 'webhook-secret'), createdBy: userId })
    .returning();
  return { webhook: (await toHooks(db, [h!]))[0]!, secret };
}

export async function hookById(db: Db, id: string) {
  const [h] = await db.select().from(webhook).where(eq(webhook.id, id));
  if (!h) fail('not_found', 'No such webhook');
  return h;
}

export async function updateHook(db: Db, h: HookRow, body: { url?: string; events?: WebhookEvent[]; active?: boolean }) {
  const [u] = await db.update(webhook).set(body).where(eq(webhook.id, h.id)).returning();
  return (await toHooks(db, [u!]))[0]!;
}

export const toDelivery = (d: DeliveryRow) => ({
  id: d.id,
  event: d.event as WebhookEvent,
  status: d.status,
  attempts: d.attempts,
  responseStatus: d.responseStatus,
  error: d.error,
  createdAt: d.createdAt.toISOString(),
  nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
});

export async function listDeliveries(db: Db, hookId: string, q: { limit: number; cursor?: string }) {
  const before = q.cursor ? new Date(Buffer.from(q.cursor, 'base64url').toString()) : null;
  const rows = await db
    .select()
    .from(webhookDelivery)
    .where(and(eq(webhookDelivery.webhookId, hookId), before ? lt(webhookDelivery.createdAt, before) : undefined))
    .orderBy(desc(webhookDelivery.createdAt))
    .limit(q.limit + 1);
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return {
    items: page.map(toDelivery),
    returned: page.length,
    hasMore,
    nextCursor: hasMore ? Buffer.from(page[page.length - 1]!.createdAt.toISOString()).toString('base64url') : null,
  };
}

/** Queue one event for every active endpoint of the workspace that subscribes to it. */
export async function dispatch(db: Db, workspaceId: string, event: WebhookEvent, data: WebhookPayload['data']) {
  const hooks = await db.select().from(webhook).where(and(eq(webhook.organizationId, workspaceId), eq(webhook.active, true)));
  const ids: string[] = [];
  for (const h of hooks) {
    if (!(h.events as string[]).includes(event)) continue;
    ids.push(await queueDelivery(db, h, event, data));
  }
  return ids;
}

async function queueDelivery(db: Db, h: HookRow, event: WebhookEvent, data: WebhookPayload['data']) {
  const id = uuidv7();
  const payload: WebhookPayload = { id, event, createdAt: new Date().toISOString(), workspaceId: h.organizationId, data };
  await db.insert(webhookDelivery).values({ id, webhookId: h.id, event, payload, nextAttemptAt: new Date() });
  await enqueue(db, 'webhook-deliver', { deliveryId: id }, { maxAttempts: 1 });
  return id;
}

/** POST one delivery now. Returns the updated row. Retries are scheduled as new jobs. */
export async function attempt(db: Db, deliveryId: string): Promise<DeliveryRow | null> {
  const [d] = await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, deliveryId));
  if (!d || d.status !== 'pending') return d ?? null;
  const [h] = await db.select().from(webhook).where(eq(webhook.id, d.webhookId));
  if (!h) return null;
  const body = JSON.stringify(d.payload);
  const secret = unseal(h.secretEnc, 'webhook-secret');
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(h.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'nib-webhooks/1',
        [WEBHOOK_SIGNATURE_HEADER]: sign(secret, body),
        [WEBHOOK_EVENT_HEADER]: d.event,
        [WEBHOOK_DELIVERY_HEADER]: d.id,
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    await res.body?.cancel().catch(() => {});
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  const attempts = d.attempts + 1;
  const ok = !error;
  const giveUp = !ok && attempts >= MAX_ATTEMPTS;
  const next = !ok && !giveUp ? new Date(Date.now() + RETRY_DELAYS_S[attempts - 1]! * 1000) : null;
  const [u] = await db
    .update(webhookDelivery)
    .set({ attempts, responseStatus: status, error, status: ok ? 'ok' : giveUp ? 'failed' : 'pending', nextAttemptAt: next, lastAttemptAt: new Date() })
    .where(eq(webhookDelivery.id, d.id))
    .returning();
  if (next) await enqueue(db, 'webhook-deliver', { deliveryId: d.id }, { runAt: next, maxAttempts: 1 });
  return u ?? null;
}

/** "Send test": a signed capture.created sample to one endpoint, posted at once. */
export async function testHook(db: Db, h: HookRow) {
  const now = new Date().toISOString();
  const id = await queueDelivery(db, h, 'capture.created', {
    capture: {
      id: '00000000-0000-7000-8000-000000000000',
      kind: 'screenshot',
      source: 'extension',
      title: 'Test delivery',
      url: 'http://localhost/c/00000000-0000-7000-8000-000000000000',
      pageUrl: 'https://example.com/',
      author: null,
      env: null,
      mediaUrls: [],
      createdAt: now,
    },
  });
  return (await attempt(db, id))!;
}
