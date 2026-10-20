// The embed (D-210, D-211): a project's public key, the config the embedded toolbar boots from, and
// the capture it starts. The key is public by design, like an analytics id, and stored in clear;
// the browser origin check stops casual reuse on other sites and the per-address limit the rest.
import { count, eq, sql, sum } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { LIMITS, randomToken } from '@toolbar/shared';
import { EMBED_KEY_PREFIX, EMBED_KEY_RE, REQUEST_ORIGIN_HEADER, type EmbedConfig, type embedCreateBodySchema } from '@toolbar/shared/api';
import { pageOrigin } from '@toolbar/shared/projects';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import { asset, project, recording } from '../db/schema/index.ts';
import { fail } from '../share/http.ts';
import { getBrand } from '../branding/index.ts';
import { embedOriginAllowed } from '../projects/access.ts';
import { createCaptureRecord } from '../upload/service.ts';
import { rateLimited } from '../dashboard/links.ts';
import { setting } from '../settings/index.ts';

type Row = typeof project.$inferSelect;
type CreateBody = z.output<typeof embedCreateBodySchema>;

export const newEmbedKey = () => randomToken(16, EMBED_KEY_PREFIX);

/** The project of a key; 404 for a malformed, unknown or turned-off key. */
export async function projectByEmbedKey(db: Db, key: string): Promise<Row> {
  if (!EMBED_KEY_RE.test(key)) fail('not_found', 'No such embed key');
  const [p] = await db.select().from(project).where(eq(project.embedKey, key)).limit(1);
  if (!p) fail('not_found', 'No such embed key');
  return p;
}

/**
 * The page origin a browser request came from: the copy server.js keeps of the real Origin (it
 * rewrites Origin for Bearer requests), else Origin, else the Referer's origin.
 */
export function requestOrigin(headers: Headers): string | null {
  const o = headers.get(REQUEST_ORIGIN_HEADER) ?? headers.get('origin');
  if (o && o !== 'null') return pageOrigin(o);
  return pageOrigin(headers.get('referer'));
}

function checkOrigin(p: Row, headers: Headers, pageUrl?: string) {
  const origin = requestOrigin(headers);
  if (!embedOriginAllowed(p, origin)) fail('origin_not_allowed', `${origin ?? 'This page'} is not an origin of this project`);
  if (pageUrl !== undefined && pageOrigin(pageUrl) !== origin) fail('origin_not_allowed', 'The page is not on the origin the request came from');
}

export async function embedConfigOf(db: Db, key: string, headers: Headers): Promise<EmbedConfig> {
  const p = await projectByEmbedKey(db, key);
  checkOrigin(p, headers);
  const b = await getBrand(db);
  return {
    project: { id: p.id, name: p.name },
    workspaceId: p.organizationId,
    maskingPreset: p.maskingPreset,
    bodyAllowlist: p.bodyAllowlist,
    traceOpenMs: p.traceOpenMs,
    brand: { name: b.name, accent: b.accent },
  };
}

/**
 * Client address for the rate limits; adapters without one share a bucket. Behind a proxy this is
 * the address ADDRESS_HEADER and XFF_DEPTH point adapter-node at (docs/configuration.md).
 */
export function clientAddress(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return 'unknown';
  }
}

/**
 * Start a capture through a key: the project and workspace come from the key, the author from the
 * reviewer (no account), the access is workspace only. Idempotent on clientId for the same reviewer
 * and project.
 */
export async function embedCreate(db: Db, event: RequestEvent, key: string, body: CreateBody): Promise<{ id: string; uploadToken: string; created: boolean }> {
  const p = await projectByEmbedKey(db, key);
  checkOrigin(p, event.request.headers, body.page.url);
  const reviewer = body.reviewer;
  const [existing] = await db
    .select({ source: recording.source, projectId: recording.projectId, subject: recording.authorSubject })
    .from(recording)
    .where(eq(recording.clientId, body.clientId))
    .limit(1);
  if (existing && (existing.source !== 'embed' || existing.projectId !== p.id || existing.subject !== (reviewer?.id ?? null)))
    fail('conflict', 'clientId already used by another capture');
  if (!existing && rateLimited(`embed:${clientAddress(event)}:${key}`, setting('embedRateLimit') ?? 60, 60 * 60_000))
    fail('rate_limited', 'Too many captures from here; try again later');
  const r = await createCaptureRecord(db, {
    organizationId: p.organizationId,
    projectId: p.id,
    maskingPreset: p.maskingPreset,
    clientId: body.clientId,
    kind: body.kind,
    page: body.page,
    startedAt: body.startedAt,
    env: body.env,
    durationMs: body.durationMs,
    source: 'embed',
    author: { userId: null, name: reviewer?.name || null, email: reviewer?.email ?? null, issuer: 'embed', subject: reviewer?.id ?? null },
    access: 'workspace',
  });
  return { id: r.id, uploadToken: r.uploadToken, created: r.created };
}

/**
 * What an embed capture's upload token may still write (D-213), checked before an asset or
 * feedback items are stored: nothing later than LIMITS.embedWriteAfterFinalizeMs after finalize,
 * ten times the embed create limit of calls per address in an hour, and for an asset
 * LIMITS.embedAssetBytes, LIMITS.embedAssetCount per capture and LIMITS.embedAssetTotalBytes in all.
 * The token itself stops with the key (captureAccess).
 */
export async function embedUploadWrite(db: Db, event: RequestEvent, rec: typeof recording.$inferSelect, file?: { bytes: number }) {
  if (rec.finalizedAt && Date.now() - rec.finalizedAt.getTime() > LIMITS.embedWriteAfterFinalizeMs)
    fail('expired', 'This capture was sent too long ago to take more');
  if (rateLimited(`embed-upload:${clientAddress(event)}`, 10 * (setting('embedRateLimit') ?? 60), 60 * 60_000))
    fail('rate_limited', 'Too many uploads from here; try again later');
  if (!file) return;
  if (file.bytes > LIMITS.embedAssetBytes) fail('too_large', `Embed assets are at most ${LIMITS.embedAssetBytes} bytes`);
  const [had] = await db
    .select({ n: count(), bytes: sum(asset.bytes).mapWith(Number) })
    .from(asset)
    .where(eq(asset.recordingId, rec.id));
  if ((had?.n ?? 0) >= LIMITS.embedAssetCount) fail('too_large', `An embed capture holds at most ${LIMITS.embedAssetCount} files`);
  if ((had?.bytes ?? 0) + file.bytes > LIMITS.embedAssetTotalBytes) fail('too_large', `An embed capture holds at most ${LIMITS.embedAssetTotalBytes} bytes of files`);
}

/**
 * Turn the embed on with a new key, or replace the key: the old one stops at once, and so do the
 * upload tokens of captures started before (D-213), compared against this time at the database's clock.
 */
export async function rotateEmbedKey(db: Db, projectId: string): Promise<Row> {
  const [r] = await db.update(project).set({ embedKey: newEmbedKey(), embedKeyCreatedAt: sql`now()`, updatedAt: new Date() }).where(eq(project.id, projectId)).returning();
  if (!r) fail('not_found', 'No such project');
  return r;
}

export async function deleteEmbedKey(db: Db, projectId: string): Promise<Row> {
  const [r] = await db.update(project).set({ embedKey: null, embedKeyCreatedAt: null, updatedAt: new Date() }).where(eq(project.id, projectId)).returning();
  if (!r) fail('not_found', 'No such project');
  return r;
}
