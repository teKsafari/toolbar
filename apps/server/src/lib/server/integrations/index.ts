// Workspace integrations (J-139, J-140, J-251), filing from a capture (J-137, J-138, J-242) and
// linked issues (J-241). Tokens and webhook URLs are sealed at rest and never returned.
import { asc, desc, eq } from 'drizzle-orm';
import type { Integration, LinkedIssue, ConnectIntegrationBody } from '@toolbar/shared/api';
import { parseIssueRefs, refOfUrl } from '@toolbar/shared/areas/dashboard';
import type { Db } from '../db/index.ts';
import { integration, linkedIssue, recording, recordingLink } from '../db/schema/index.ts';
import { seal, unseal } from '../crypto.ts';
import { fail } from '../share/http.ts';
import { audit, captureUrl, patchRawSettings, peopleById, settingsRow } from '../dashboard/core.ts';
import { github, gitlab, slack, ProviderError } from './providers.ts';
import { issueMarkdown, loadSignals, slackText } from './issue-body.ts';

type Row = typeof integration.$inferSelect;
type RecordingRow = typeof recording.$inferSelect;

export interface IntegrationConfig {
  name: string;
  account: string | null;
  baseUrl: string | null;
  defaultTarget: string | null;
  /** base64 of the sealed token or webhook URL */
  secret: string;
  status: 'ok' | 'error';
  lastError: string | null;
}

const cfg = (r: Row) => r.config as IntegrationConfig;
const sealB64 = (s: string) => seal(s, 'integration-secret').toString('base64');
const secretOf = (r: Row) => unseal(Buffer.from(cfg(r).secret, 'base64'), 'integration-secret');

export async function toIntegrations(db: Db, rows: Row[]): Promise<Integration[]> {
  const people = await peopleById(db, rows.map((r) => r.createdBy));
  return rows.map((r) => {
    const c = cfg(r);
    return {
      id: r.id,
      workspaceId: r.organizationId,
      type: r.type as Integration['type'],
      name: c.name,
      account: c.account,
      baseUrl: c.baseUrl,
      defaultTarget: c.defaultTarget,
      status: c.status ?? 'ok',
      lastError: c.lastError ?? null,
      createdBy: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function listIntegrations(db: Db, workspaceId: string) {
  const rows = await db.select().from(integration).where(eq(integration.organizationId, workspaceId)).orderBy(asc(integration.createdAt));
  return toIntegrations(db, rows.filter((r) => ['github', 'gitlab', 'slack'].includes(r.type)));
}

const strip = (u: string) => u.replace(/\/+$/, '');

export async function connect(db: Db, workspaceId: string, userId: string, body: ConnectIntegrationBody & { baseUrl?: string }) {
  let config: IntegrationConfig;
  try {
    if (body.type === 'github') {
      const base = strip(body.baseUrl ?? 'https://api.github.com');
      const login = await github.whoami(base, body.token);
      config = { name: body.name || `GitHub (${login})`, account: login, baseUrl: base, defaultTarget: body.defaultRepo ?? null, secret: sealB64(body.token), status: 'ok', lastError: null };
    } else if (body.type === 'gitlab') {
      const base = strip(body.baseUrl ?? 'https://gitlab.com');
      const login = await gitlab.whoami(base, body.token);
      config = { name: body.name || `GitLab (${login})`, account: login, baseUrl: base, defaultTarget: body.defaultProject ?? null, secret: sealB64(body.token), status: 'ok', lastError: null };
    } else {
      slack.check(body.webhookUrl);
      config = {
        name: body.name || `Slack${body.channelLabel ? ` ${body.channelLabel}` : ''}`,
        account: body.channelLabel ?? null,
        baseUrl: null,
        defaultTarget: null,
        secret: sealB64(body.webhookUrl),
        status: 'ok',
        lastError: null,
      };
    }
  } catch (e) {
    if (e instanceof ProviderError) fail('integration_failed', `The connection test failed: ${e.message}`);
    throw e;
  }
  const [row] = await db.insert(integration).values({ organizationId: workspaceId, type: body.type, config, createdBy: userId }).returning();
  await audit(db, { workspaceId, actorId: userId, action: 'integration.connected', target: { type: 'integration', id: row!.id, label: config.name } });
  return (await toIntegrations(db, [row!]))[0]!;
}

export async function integrationById(db: Db, id: string) {
  const [r] = await db.select().from(integration).where(eq(integration.id, id));
  if (!r) fail('not_found', 'No such integration');
  return r;
}

export async function update(db: Db, r: Row, body: { name?: string; token?: string; webhookUrl?: string; defaultTarget?: string | null }) {
  const c = { ...cfg(r) };
  if (body.name !== undefined) c.name = body.name;
  if (body.defaultTarget !== undefined) c.defaultTarget = body.defaultTarget;
  try {
    if (body.token !== undefined && r.type !== 'slack') {
      c.account = r.type === 'github' ? await github.whoami(c.baseUrl!, body.token) : await gitlab.whoami(c.baseUrl!, body.token);
      c.secret = sealB64(body.token);
      c.status = 'ok';
      c.lastError = null;
    }
    if (body.webhookUrl !== undefined && r.type === 'slack') {
      slack.check(body.webhookUrl);
      c.secret = sealB64(body.webhookUrl);
      c.status = 'ok';
      c.lastError = null;
    }
  } catch (e) {
    if (e instanceof ProviderError) fail('integration_failed', `The connection test failed: ${e.message}`);
    throw e;
  }
  const [u] = await db.update(integration).set({ config: c }).where(eq(integration.id, r.id)).returning();
  return (await toIntegrations(db, [u!]))[0]!;
}

export async function remove(db: Db, r: Row, actorId: string) {
  await db.delete(integration).where(eq(integration.id, r.id));
  await audit(db, { workspaceId: r.organizationId, actorId, action: 'integration.removed', target: { type: 'integration', id: r.id, label: cfg(r).name } });
}

export async function options(db: Db, r: Row, q: { repo?: string; q?: string }) {
  const c = cfg(r);
  try {
    if (r.type === 'github') return await github.options(c.baseUrl!, secretOf(r), q.repo ?? c.defaultTarget ?? undefined, q.q);
    if (r.type === 'gitlab') return await gitlab.options(c.baseUrl!, secretOf(r), q.repo ?? c.defaultTarget ?? undefined, q.q);
    return { repos: [], labels: [], assignees: [], milestones: [] };
  } catch (e) {
    if (e instanceof ProviderError) {
      await markError(db, r, e.message);
      fail('integration_failed', e.message);
    }
    throw e;
  }
}

async function markError(db: Db, r: Row, message: string | null) {
  const c = { ...cfg(r), status: message ? ('error' as const) : ('ok' as const), lastError: message };
  await db.update(integration).set({ config: c }).where(eq(integration.id, r.id));
}

export interface SendFields {
  repo?: string;
  title?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
  message?: string;
}

/**
 * File the capture to an integration: an issue on GitHub or GitLab, a message on Slack.
 * Stores the linked issue and remembers the fields for next time (J-140 recents).
 */
export async function sendCapture(db: Db, rec: RecordingRow, r: Row, fields: SendFields, actorId: string | null, link?: string): Promise<LinkedIssue> {
  if (r.organizationId !== rec.organizationId) fail('forbidden', 'This app is connected to another workspace');
  const c = cfg(r);
  const url = link ?? captureUrl(rec.id);
  const signals = await loadSignals(rec.id);
  const src = {
    id: rec.id,
    title: fields.title || rec.title || 'Capture',
    description: rec.description,
    pageUrl: rec.pageUrl,
    createdAt: rec.finalizedAt ?? rec.createdAt,
    env: rec.env as Record<string, unknown> | null,
    authorName: rec.authorName,
  };
  let issue: LinkedIssue;
  try {
    if (r.type === 'slack') {
      await slack.post(secretOf(r), slackText(src, signals, url, fields.message));
      issue = { integrationId: r.id, type: 'slack', url, key: c.account ? `Slack ${c.account}` : 'Slack', title: src.title, createdAt: new Date().toISOString() };
    } else {
      const repo = fields.repo || c.defaultTarget;
      if (!repo) fail('invalid_body', r.type === 'github' ? 'Pick a repository' : 'Pick a project');
      const body = issueMarkdown(src, signals, url);
      const f = { repo: repo!, title: src.title, body, labels: fields.labels ?? [], assignees: fields.assignees ?? [], milestone: fields.milestone };
      const filed = r.type === 'github' ? await github.file(c.baseUrl!, secretOf(r), f) : await gitlab.file(c.baseUrl!, secretOf(r), f);
      issue = { integrationId: r.id, type: r.type, url: filed.url, key: filed.key, title: filed.title, createdAt: new Date().toISOString() };
    }
  } catch (e) {
    if (e instanceof ProviderError) {
      await markError(db, r, e.message);
      fail('integration_failed', `${c.name}: ${e.message}`);
    }
    throw e;
  }
  if (c.status !== 'ok') await markError(db, r, null);
  if (r.type !== 'slack')
    await db
      .insert(linkedIssue)
      .values({ recordingId: rec.id, integrationId: r.id, type: issue.type, url: issue.url, key: issue.key, title: issue.title })
      .onConflictDoNothing();
  if (actorId) {
    const raw = ((await settingsRow(db, actorId))?.settings ?? {}) as { editor?: { recentFields?: Record<string, unknown> } };
    const recent = { ...(raw.editor?.recentFields ?? {}), [r.id]: { repo: fields.repo ?? c.defaultTarget, labels: fields.labels ?? [], assignees: fields.assignees ?? [], milestone: fields.milestone ?? null } };
    await patchRawSettings(db, actorId, { editor: { recentFields: recent, lastDestination: { integrationId: r.id, fields } } });
  }
  return issue;
}

/** Issues on a capture: filed ones, plus references in its title, description and link ticket (J-241). */
export async function linkedIssuesOf(db: Db, rec: RecordingRow): Promise<LinkedIssue[]> {
  await syncTextRefs(db, rec);
  const rows = await db.select().from(linkedIssue).where(eq(linkedIssue.recordingId, rec.id)).orderBy(desc(linkedIssue.createdAt));
  return rows.map((r) => ({ integrationId: r.integrationId, type: r.type, url: r.url, key: r.key, title: r.title, createdAt: r.createdAt.toISOString() }));
}

/** Store references found in the capture's text and its recording link's ticket as linked issues. */
export async function syncTextRefs(db: Db, rec: RecordingRow) {
  const refs = parseIssueRefs(`${rec.title}\n${rec.description}`);
  const vals: (typeof linkedIssue.$inferInsert)[] = refs.map((r) => ({
    recordingId: rec.id,
    type: r.tracker,
    url: r.url ?? `ref:${r.key}`,
    key: r.key,
    title: null,
  }));
  if (rec.recordingLinkId) {
    const [l] = await db.select({ refUrl: recordingLink.refUrl }).from(recordingLink).where(eq(recordingLink.id, rec.recordingLinkId));
    if (l?.refUrl) {
      const ref = refOfUrl(l.refUrl);
      vals.push({ recordingId: rec.id, type: ref.tracker, url: ref.url, key: ref.key ?? ref.url, title: null });
    }
  }
  const meta = rec.metadata as { ref?: string } | null;
  if (meta?.ref && /^https?:\/\//.test(meta.ref)) {
    const ref = refOfUrl(meta.ref);
    vals.push({ recordingId: rec.id, type: ref.tracker, url: ref.url, key: ref.key ?? ref.url, title: null });
  }
  if (vals.length) await db.insert(linkedIssue).values(vals).onConflictDoNothing();
}

/** server-core's finalize calls this for a draft whose destination is an integration (J-137). */
export async function destinationHandler(
  db: Db,
  rec: RecordingRow,
  destination: { type: 'integration'; integrationId: string; fields: Record<string, unknown> },
  shareUrl: string,
): Promise<LinkedIssue> {
  const r = await integrationById(db, destination.integrationId);
  const f = destination.fields as SendFields;
  void shareUrl;
  return sendCapture(db, rec, r, { ...f, title: f.title ?? rec.title }, rec.authorUserId);
}

