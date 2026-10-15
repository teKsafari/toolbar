// A stand-in for the server routes the editor calls (contract: packages/shared/src/api), so the
// editor e2e runs before server-core lands: bootstrap, create, assets, finalize, ai-draft,
// settings, plus a /c/:id page for the opened capture tab.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export interface MockAsset {
  id: string;
  kind: string;
  recordingId: string | null;
  name: string;
  type: string;
  bytes: Buffer;
}

export interface MockState {
  url: string;
  recordings: Map<string, { body: Record<string, unknown>; finalize?: Record<string, unknown> }>;
  assets: Map<string, MockAsset>;
  finalizes: { id: string; body: Record<string, unknown> }[];
  settingsPatches: unknown[];
  ai: { status: number; body: unknown; delayMs: number };
  aiCalls: number;
  bootstrapCalls: string[];
  /** paused features the mock server reports as on; the editor tests run with them on */
  features: { ai: boolean; trackers: boolean; slack: boolean };
  close(): Promise<void>;
}

const WS1 = '019a0000-0000-7000-8000-0000000000a1';
const WS2 = '019a0000-0000-7000-8000-0000000000a2';
export const MOCK_IDS = { WS1, WS2, F1: '019a0000-0000-7000-8000-0000000000f1', F2: '019a0000-0000-7000-8000-0000000000f2', F3: '019a0000-0000-7000-8000-0000000000f3', GH: '019a0000-0000-7000-8000-00000000091a' };

const person = { id: '019a0000-0000-7000-8000-000000000001', name: 'Dana Reviewer', email: 'dana@toolbar.test', image: null };
const ws = (id: string, name: string) => ({ id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), logoUrl: null, role: 'admin', isOwner: true, memberCount: 2, createdAt: '2026-10-14T00:00:00.000Z' });
const folder = (id: string, workspaceId: string, name: string) => ({ id, shortId: id.slice(-4), workspaceId, name, parentId: null, private: false, captureCount: 0, createdBy: person, createdAt: '2026-10-14T00:00:00.000Z' });

export function bootstrapFor(workspaceId: string | null, aiAvailable = true, features = { ai: true, trackers: true, slack: true }) {
  const active = workspaceId ?? WS1;
  return {
    user: person,
    workspaces: [ws(WS1, 'Lab shop'), ws(WS2, 'Second team')],
    activeWorkspaceId: active,
    folders: active === WS1 ? [folder(MOCK_IDS.F1, WS1, 'Checkout bugs'), folder(MOCK_IDS.F2, WS1, 'Design')] : [folder(MOCK_IDS.F3, WS2, 'Team two inbox')],
    integrations:
      active === WS1
        ? [{ id: MOCK_IDS.GH, workspaceId: WS1, type: 'github', name: 'lab/shop', account: 'dana', baseUrl: null, defaultTarget: 'lab/shop', status: 'ok', lastError: null, createdBy: person, createdAt: '2026-10-14T00:00:00.000Z' }]
        : [],
    settings: {},
    limits: { chunkBytes: 4194304, maxRecordingMs: null, aiAvailable },
    serverVersion: 'mock',
    // the AI and destination tests run against a server with the paused features on (FEATURE_AI,
    // FEATURE_TRACKERS, FEATURE_SLACK); a test turns them off through state.features
    features,
  };
}

export async function startMock(port: number): Promise<MockState> {
  const url = `http://127.0.0.1:${port}`;
  const state: MockState = {
    url,
    recordings: new Map(),
    assets: new Map(),
    finalizes: [],
    settingsPatches: [],
    ai: { status: 503, body: { error: 'unavailable' }, delayMs: 0 },
    aiCalls: 0,
    bootstrapCalls: [],
    features: { ai: true, trackers: true, slack: true },
    close: async () => {},
  };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const u = new URL(req.url ?? '/', url);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const authed = /^Bearer tb_dev_/.test(req.headers.authorization ?? '');
    if (u.pathname.startsWith('/api/') && !authed) return json(401, { error: 'unauthorized' });
    let m: RegExpMatchArray | null;
    if (req.method === 'GET' && u.pathname === '/api/v1/ext/bootstrap') {
      const w = u.searchParams.get('workspaceId');
      state.bootstrapCalls.push(w ?? '');
      return json(200, bootstrapFor(w, state.ai.status !== 503, state.features));
    }
    if (req.method === 'POST' && u.pathname === '/api/v1/recordings') {
      const body = JSON.parse(raw.toString());
      const id = randomUUID();
      state.recordings.set(id, { body });
      return json(201, { id, shareUrl: `${url}/s/share-${id.slice(0, 8)}` });
    }
    if (req.method === 'POST' && u.pathname === '/api/v1/assets') {
      const fd = await new Request(url, { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: raw }).formData();
      const file = fd.get('file') as File;
      const id = randomUUID();
      const a: MockAsset = { id, kind: String(fd.get('kind')), recordingId: (fd.get('recordingId') as string) ?? null, name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
      state.assets.set(id, a);
      return json(201, { id, kind: a.kind, url: `${url}/assets/${id}`, contentType: a.type, width: null, height: null, bytes: a.bytes.length, name: a.name });
    }
    if (req.method === 'GET' && (m = u.pathname.match(/^\/assets\/([\w-]+)$/))) {
      const a = state.assets.get(m[1]!);
      if (!a) return json(404, { error: 'not_found' });
      res.writeHead(200, { 'content-type': a.type, 'access-control-allow-origin': '*' });
      return res.end(a.bytes);
    }
    if (req.method === 'POST' && (m = u.pathname.match(/^\/api\/v1\/recordings\/([\w-]+)\/finalize$/))) {
      const body = JSON.parse(raw.toString());
      const id = m[1]!;
      state.finalizes.push({ id, body });
      const rec = state.recordings.get(id);
      if (rec) rec.finalize = body;
      return json(200, { id, shareUrl: `${url}/s/share-${id.slice(0, 8)}`, status: 'processing', issue: null, issueError: null });
    }
    if (req.method === 'POST' && (m = u.pathname.match(/^\/api\/v1\/recordings\/([\w-]+)\/ai-draft$/))) {
      state.aiCalls++;
      if (state.ai.delayMs) await new Promise((r) => setTimeout(r, state.ai.delayMs));
      return json(state.ai.status, state.ai.body);
    }
    if (req.method === 'PATCH' && u.pathname === '/api/v1/me/settings') {
      state.settingsPatches.push(JSON.parse(raw.toString()));
      return json(200, {});
    }
    if (req.method === 'GET' && (m = u.pathname.match(/^\/c\/([\w-]+)$/))) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Capture ${m[1]}</title><h1 id="capture">${m[1]}</h1>`);
    }
    if (req.method === 'GET' && u.pathname.startsWith('/settings/')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>Settings</title><h1>Settings</h1>');
    }
    json(404, { error: 'not_found', message: `${req.method} ${u.pathname}` });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  state.close = () =>
    new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections();
    });
  return state;
}
