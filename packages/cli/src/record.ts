// `nib record --cdp <url>` (J-246): record a Chromium that an agent drives. Attaches over the
// DevTools protocol and captures console, uncaught errors, network with headers and small text
// bodies, WebSocket frames, navigations, and video from the screencast. It also serves a CDP
// proxy: an agent that connects through it (Playwright connectOverCDP, Puppeteer,
// chrome-devtools-mcp) has its input commands counted, and every click and committed input on
// the page is logged with the element hit, password and payment fields masked.
// Forms: `nib record --cdp URL -- <command...>` wraps a command (NIB_CDP_PROXY is set for it);
// `nib record start --cdp URL` runs until `nib record stop`; `nib record status`.
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CaptureEvent, EnvInfo, EventDataMap, EventKind } from '@toolbar/shared/events';
import { CliError, connect } from './client.ts';
import { configPath } from './config.ts';
import { createCapture, finalize, uploadEvents, uploadStream, workspaceOf } from './upload.ts';
import { acceptUpgrade } from './wsserver.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TEXT_TYPES = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded|graphql)|[^;]*\+json)/i;
const SECRET_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|.*(token|secret).*)$/i;
const BODY_CAP = 64 * 1024;

/** Page-side listener: clicks and committed inputs with the element hit, secrets masked. */
const INJECT = `(() => {
  if (window.__nibRec) return; window.__nibRec = 1;
  const SECRET = /pass(word)?|pwd|otp|one-?time|2fa|totp|card|cc-|cvc|cvv|security.?code|secret/i;
  const send = (o) => { try { window.__nibRecord(JSON.stringify(o)); } catch (e) {} };
  const sel = (el) => {
    if (!(el instanceof Element)) return '';
    const t = el.getAttribute('data-testid'); if (t) return '[data-testid="' + t + '"]';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) { let s = n.localName; const p = n.parentElement;
      if (p) { const same = [...p.children].filter((c) => c.localName === n.localName); if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'; }
      parts.unshift(s); n = p; }
    return parts.join(' > ');
  };
  const target = (el) => { const r = el.getBoundingClientRect();
    return { selector: sel(el), tag: el.localName, role: el.getAttribute('role') || undefined, name: el.getAttribute('aria-label') || el.getAttribute('name') || undefined,
      text: (el.innerText || el.value || '').toString().trim().slice(0, 120) || undefined, testId: el.getAttribute('data-testid') || undefined, elId: el.id || undefined,
      rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) } }; };
  const secret = (el) => el.type === 'password' || SECRET.test(el.name || '') || SECRET.test(el.id || '') || SECRET.test(el.autocomplete || '');
  addEventListener('click', (e) => { const el = e.target.closest('a,button,input,select,textarea,label,[role],[onclick]') || e.target;
    const t = target(el); if (el.type === 'password') delete t.text; send({ type: 'click', t: Date.now(), target: t, x: e.clientX, y: e.clientY }); }, true);
  addEventListener('change', (e) => { const el = e.target; if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    const m = secret(el); const t = target(el); delete t.text; send({ type: 'input', t: Date.now(), target: t, masked: m, value: m ? '*'.repeat(Math.min(12, String(el.value).length)) : String(el.value).slice(0, 500) }); }, true);
  addEventListener('keydown', (e) => { if (['Enter', 'Escape', 'Tab'].includes(e.key) || e.ctrlKey || e.metaKey) {
    const mods = []; if (e.ctrlKey) mods.push('ctrl'); if (e.shiftKey) mods.push('shift'); if (e.altKey) mods.push('alt'); if (e.metaKey) mods.push('meta');
    send({ type: 'key', t: Date.now(), key: e.key, mods, target: e.target instanceof Element ? target(e.target) : undefined }); } }, true);
})();`;

class Cdp {
  private id = 1;
  private pending = new Map<number, { ok: (v: Json) => void; err: (e: Error) => void }>();
  private handlers: ((m: Json) => void)[] = [];
  constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Json;
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        if (m.error) p.err(new Error(m.error.message));
        else p.ok(m.result ?? {});
      } else if (m.method) this.handlers.forEach((h) => h(m));
    });
  }
  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((ok, err) => {
      ws.addEventListener('open', () => ok(), { once: true });
      ws.addEventListener('error', () => err(new CliError(`Cannot open the DevTools socket ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }
  send(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, err) => this.pending.set(id, { ok, err }));
  }
  on(fn: (m: Json) => void) {
    this.handlers.push(fn);
  }
  close() {
    this.ws.close();
  }
}

export interface Recording {
  events: CaptureEvent[];
  frames: { t: number; data: string }[];
  startedAt: number;
  firstUrl: string | null;
  title: string | null;
  env: EnvInfo;
  stats: { console: number; errors: number; requests: number; clicks: number; inputs: number; proxyInputs: number; frames: number };
}

export class Recorder {
  private cdp!: Cdp;
  private seqs = new Map<string, number>();
  private events: CaptureEvent[] = [];
  private frames: { t: number; data: string }[] = [];
  private sessions = new Map<string, string>(); // sessionId -> targetId
  private screencastSession: string | null = null;
  private monoOffset = new Map<string, number>(); // sessionId -> wall - monotonic (ms)
  private responses = new Map<string, { res: Json; sessionId: string }>();
  private startedAt = Date.now();
  private firstUrl: string | null = null;
  private title: string | null = null;
  private env: EnvInfo = { ua: '', viewport: { w: 0, h: 0 }, dpr: 1 };
  stats = { console: 0, errors: 0, requests: 0, clicks: 0, inputs: 0, proxyInputs: 0, frames: 0 };
  private proxy: Server | null = null;
  proxyUrl: string | null = null;

  constructor(private cdpHttp: string) {}

  private emit<K extends EventKind>(t: number, kind: K, data: EventDataMap[K], ctx = 'top') {
    const seq = this.seqs.get(ctx) ?? 0;
    this.seqs.set(ctx, seq + 1);
    this.events.push({ v: 1, id: `${ctx}:${seq}`, ctx, seq, t, kind, data } as CaptureEvent);
  }

  private async version(): Promise<{ webSocketDebuggerUrl: string; Browser: string; 'User-Agent': string }> {
    const r = await fetch(`${this.cdpHttp}/json/version`).catch(() => null);
    if (!r?.ok) throw new CliError(`No DevTools endpoint at ${this.cdpHttp}. Start Chromium with --remote-debugging-port.`);
    return r.json() as Promise<{ webSocketDebuggerUrl: string; Browser: string; 'User-Agent': string }>;
  }

  async start(proxyPort = 0): Promise<void> {
    const v = await this.version();
    this.cdp = await Cdp.open(v.webSocketDebuggerUrl);
    const [name, version] = v.Browser.split('/');
    this.env = { ua: v['User-Agent'], browser: { name: name ?? 'Chromium', version: version ?? '' }, os: { name: process.platform }, viewport: { w: 0, h: 0 }, dpr: 1, maskingPreset: 'staging' };
    this.startedAt = Date.now();
    this.cdp.on((m) => void this.onEvent(m).catch(() => {}));
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    for (const t of targetInfos as Json[]) if (t.type === 'page' && !t.attached) await this.cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true }).catch(() => {});
    await this.startProxy(proxyPort, v.webSocketDebuggerUrl);
  }

  private async setupPage(sessionId: string, targetInfo: Json) {
    const s = (m: string, p: Json = {}) => this.cdp.send(m, p, sessionId).catch(() => ({}) as Json);
    await s('Runtime.addBinding', { name: '__nibRecord' });
    await s('Page.enable');
    await s('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    await s('Runtime.enable');
    await s('Network.enable', { maxPostDataSize: BODY_CAP });
    await s('Runtime.evaluate', { expression: INJECT });
    const dims = (await s('Runtime.evaluate', { expression: 'JSON.stringify([innerWidth, innerHeight, devicePixelRatio, screen.width, screen.height, location.href, document.title, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone])', returnByValue: true })) as Json;
    try {
      const [w, h, dpr, sw, sh, href, title, lang, tz] = JSON.parse(dims.result?.value ?? '[]') as [number, number, number, number, number, string, string, string, string];
      if (!this.env.viewport.w) Object.assign(this.env, { viewport: { w, h }, dpr, screen: { w: sw, h: sh }, locale: lang, tz, url: href, title });
      if (href && !href.startsWith('about:') && !this.firstUrl) {
        this.firstUrl = href;
        this.title = title || null;
      }
    } catch {
      /* page not scriptable */
    }
    if (!this.screencastSession) {
      this.screencastSession = sessionId;
      await s('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 });
    }
    await s('Runtime.runIfWaitingForDebugger');
    void targetInfo;
  }

  private wall(sessionId: string, mono: number | undefined, wallTime?: number): number {
    if (wallTime) {
      const off = wallTime * 1000 - (mono ?? 0) * 1000;
      if (mono !== undefined) this.monoOffset.set(sessionId, off);
      return wallTime * 1000;
    }
    const off = this.monoOffset.get(sessionId);
    return off !== undefined && mono !== undefined ? mono * 1000 + off : Date.now();
  }

  private async onEvent(m: Json) {
    const p = m.params ?? {};
    const sid: string = m.sessionId ?? '';
    switch (m.method) {
      case 'Target.attachedToTarget':
        if (p.targetInfo?.type === 'page') {
          this.sessions.set(p.sessionId, p.targetInfo.targetId);
          await this.setupPage(p.sessionId, p.targetInfo);
        }
        break;
      case 'Target.targetCreated':
        if (p.targetInfo?.type === 'page' && !p.targetInfo.attached) await this.cdp.send('Target.attachToTarget', { targetId: p.targetInfo.targetId, flatten: true }).catch(() => {});
        break;
      case 'Page.screencastFrame':
        void this.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sid).catch(() => {});
        this.frames.push({ t: (p.metadata?.timestamp ?? Date.now() / 1000) * 1000, data: p.data });
        this.stats.frames++;
        break;
      case 'Page.frameNavigated':
        if (!p.frame?.parentId) {
          const url = p.frame.url as string;
          if (!url.startsWith('about:') && !this.firstUrl) this.firstUrl = url;
          this.emit(Date.now(), 'nav', { type: 'load', url });
        }
        break;
      case 'Page.navigatedWithinDocument':
        this.emit(Date.now(), 'nav', { type: 'pushState', url: p.url });
        break;
      case 'Runtime.consoleAPICalled': {
        this.stats.console++;
        const lvl = p.type === 'warning' ? 'warn' : ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir', 'assert', 'count'].includes(p.type) ? p.type : 'log';
        const args = (p.args as Json[]).map((a) => (a.value !== undefined ? a.value : (a.description ?? a.unserializableValue ?? `[${a.type}]`)));
        const frames = (p.stackTrace?.callFrames as Json[] | undefined) ?? [];
        const stack = frames.length ? frames.slice(0, 8).map((f) => `    at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`).join('\n') : undefined;
        this.emit(p.timestamp ?? Date.now(), 'console', { level: lvl, args, ...(stack ? { stack } : {}) });
        break;
      }
      case 'Runtime.exceptionThrown': {
        this.stats.errors++;
        const d = p.exceptionDetails ?? {};
        const desc: string = d.exception?.description ?? d.text ?? 'Uncaught error';
        const [first] = desc.split('\n');
        const nm = /^(\w*Error)\b:?\s*(.*)$/.exec(first ?? '');
        this.emit(p.timestamp ?? Date.now(), 'error', { type: 'error', message: nm ? nm[2]! : (first ?? desc), ...(nm ? { name: nm[1] } : {}), stack: desc, ...(d.url ? { src: d.url, line: d.lineNumber + 1, col: d.columnNumber + 1 } : {}) });
        break;
      }
      case 'Runtime.bindingCalled':
        if (p.name === '__nibRecord') {
          const ev = JSON.parse(p.payload) as Json;
          if (ev.type === 'click') this.stats.clicks++;
          if (ev.type === 'input') this.stats.inputs++;
          const { t, ...data } = ev;
          this.emit(t ?? Date.now(), 'user', data as EventDataMap['user']);
        }
        break;
      case 'Network.requestWillBeSent': {
        if (/^data:/.test(p.request.url)) break;
        this.stats.requests++;
        const t = this.wall(sid, p.timestamp, p.wallTime);
        const headers = Object.fromEntries(Object.entries(p.request.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), SECRET_HEADER.test(k) ? '[redacted]' : v]));
        const type = String(p.type ?? '').toLowerCase();
        this.emit(t, 'net.req', {
          rid: p.requestId,
          method: p.request.method,
          url: p.request.url,
          headers,
          ...(p.request.postData ? { body: String(p.request.postData).slice(0, BODY_CAP) } : {}),
          initiator: type === 'fetch' ? 'fetch' : type === 'xhr' ? 'xhr' : type === 'document' ? 'document' : type === 'script' ? 'script' : type === 'image' ? 'image' : 'other',
          source: 'page',
        });
        break;
      }
      case 'Network.responseReceived':
        this.responses.set(p.requestId, { res: { ...p.response, _t: this.wall(sid, p.timestamp) }, sessionId: sid });
        break;
      case 'Network.loadingFinished': {
        const r = this.responses.get(p.requestId);
        if (!r) break;
        this.responses.delete(p.requestId);
        const res = r.res;
        let body: string | undefined;
        if (TEXT_TYPES.test(res.mimeType ?? '') && (p.encodedDataLength ?? 0) < BODY_CAP * 4) {
          const b = (await this.cdp.send('Network.getResponseBody', { requestId: p.requestId }, sid).catch(() => null)) as Json | null;
          if (b && !b.base64Encoded) body = String(b.body).slice(0, BODY_CAP);
        }
        const end = this.wall(sid, p.timestamp);
        const headers = Object.fromEntries(Object.entries((res.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), SECRET_HEADER.test(k) ? '[redacted]' : v]));
        this.emit(end, 'net.res', {
          rid: p.requestId,
          status: res.status,
          statusText: res.statusText,
          headers,
          ...(body !== undefined ? { body, truncated: body.length >= BODY_CAP } : {}),
          contentType: res.mimeType,
          encodedSize: p.encodedDataLength,
          timing: { start: res._t, end },
        });
        break;
      }
      case 'Network.loadingFailed':
        this.responses.delete(p.requestId);
        this.emit(this.wall(sid, p.timestamp), 'net.fail', { rid: p.requestId, error: p.canceled ? 'abort' : String(p.errorText ?? 'net::ERR_FAILED') });
        break;
      case 'Network.webSocketCreated':
        this.emit(Date.now(), 'ws', { sid: p.requestId, op: 'open', url: p.url });
        break;
      case 'Network.webSocketFrameSent':
      case 'Network.webSocketFrameReceived':
        this.emit(this.wall(sid, p.timestamp), 'ws', { sid: p.requestId, op: m.method.endsWith('Sent') ? 'send' : 'recv', data: String(p.response?.payloadData ?? '').slice(0, 4096) });
        break;
      case 'Network.webSocketClosed':
        this.emit(this.wall(sid, p.timestamp), 'ws', { sid: p.requestId, op: 'close' });
        break;
    }
  }

  /** CDP proxy: relays an agent's DevTools connection to the browser and counts its input commands. */
  private async startProxy(port: number, upstreamWs: string) {
    const up = new URL(upstreamWs);
    const srv = createServer(async (req, res) => {
      const path = req.url ?? '/';
      if (!path.startsWith('/json')) {
        res.writeHead(404).end();
        return;
      }
      const r = await fetch(`${this.cdpHttp}${path}`).catch(() => null);
      if (!r) {
        res.writeHead(502).end();
        return;
      }
      const host = `127.0.0.1:${(srv.address() as { port: number }).port}`;
      const text = (await r.text()).replaceAll(`ws://${up.host}/`, `ws://${host}/`).replaceAll(`"${up.host}`, `"${host}`);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(text);
    });
    srv.on('upgrade', (req, socket) => {
      const target = `ws://${up.host}${req.url}`;
      const peer = acceptUpgrade(req, socket);
      const upstream = new WebSocket(target);
      const queue: string[] = [];
      upstream.addEventListener('open', () => queue.splice(0).forEach((q) => upstream.send(q)));
      upstream.addEventListener('message', (ev) => peer.send(String(ev.data)));
      upstream.addEventListener('close', () => peer.close());
      upstream.addEventListener('error', () => peer.close());
      peer.onMessage((text) => {
        if (/"method":"Input\.(dispatchMouseEvent|dispatchKeyEvent|insertText|dispatchTouchEvent)"/.test(text)) {
          if (!/"type":"mouse(Moved|Released)"|"type":"keyUp"/.test(text)) this.stats.proxyInputs++;
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
        else queue.push(text);
      });
      peer.onClose(() => upstream.close());
    });
    await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
    this.proxy = srv;
    this.proxyUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  }

  async stop(): Promise<Recording> {
    if (this.screencastSession) await this.cdp.send('Page.stopScreencast', {}, this.screencastSession).catch(() => {});
    if (!this.frames.length && this.screencastSession) {
      const shot = (await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, this.screencastSession).catch(() => null)) as Json | null;
      if (shot?.data) this.frames.push({ t: Date.now(), data: shot.data });
    }
    this.proxy?.close();
    this.cdp.close();
    const first = this.frames[0]?.t ?? this.startedAt;
    this.emit(this.startedAt, 'env', this.env, 'sw');
    this.emit(first, 'media', { stream: 'video', op: 'start', mime: 'video/webm' }, 'off');
    this.emit(this.frames.at(-1)?.t ?? Date.now(), 'media', { stream: 'video', op: 'stop' }, 'off');
    return { events: this.events, frames: this.frames, startedAt: this.startedAt, firstUrl: this.firstUrl, title: this.title, env: this.env, stats: this.stats };
  }
}

/** Screencast frames to a WebM with each frame held until the next (variable frame rate). */
export async function framesToWebm(frames: { t: number; data: string }[]): Promise<{ bytes: Buffer; durationMs: number }> {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) throw new CliError('nib record needs ffmpeg on PATH to turn the screencast into a video.');
  const dir = await mkdtemp(join(tmpdir(), 'nib-rec-'));
  try {
    const list: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const f = join(dir, `f${String(i).padStart(6, '0')}.jpg`);
      await writeFile(f, Buffer.from(frames[i]!.data, 'base64'));
      const next = frames[i + 1]?.t ?? frames[i]!.t + 500;
      list.push(`file '${f}'`, `duration ${Math.max(0.02, (next - frames[i]!.t) / 1000).toFixed(3)}`);
    }
    list.push(`file '${join(dir, `f${String(frames.length - 1).padStart(6, '0')}.jpg`)}'`);
    await writeFile(join(dir, 'list.txt'), list.join('\n'));
    const out = join(dir, 'out.webm');
    const r = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-fps_mode', 'vfr', '-c:v', 'libvpx', '-b:v', '1500k', '-deadline', 'realtime', '-cpu-used', '8', out],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) throw new CliError('ffmpeg could not build the video from the screencast.');
    const durationMs = Math.round((frames.at(-1)!.t - frames[0]!.t) + 500);
    return { bytes: await readFile(out), durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function uploadRecording(rec: Recording, opts: { title?: string; folderId?: string; workspaceId?: string }) {
  const c = await connect();
  const workspaceId = await workspaceOf(c, opts.workspaceId);
  const video = rec.frames.length ? await framesToWebm(rec.frames) : null;
  const capture = await createCapture(c, {
    kind: 'video',
    workspaceId,
    folderId: opts.folderId,
    page: { url: rec.firstUrl ?? 'about:blank', title: rec.title ?? undefined },
    startedAt: rec.startedAt,
    env: rec.env.viewport.w ? rec.env : undefined,
    durationMs: video?.durationMs,
  });
  if (video) await uploadStream(c, capture.id, 'video', video.bytes, 'video/webm');
  await uploadEvents(c, capture.id, rec.events);
  const fin = await finalize(c, capture.id, {
    title: opts.title ?? `Agent browser session${rec.title ? `: ${rec.title}` : ''}`,
    description: '',
    ...(video ? { durationMs: video.durationMs } : {}),
    ...(opts.folderId ? { folderId: opts.folderId } : {}),
  });
  return { id: fin.id, url: fin.shareUrl, kind: 'video', durationMs: video?.durationMs ?? null, stats: rec.stats };
}

const statePath = () => join(dirname(configPath()), 'record.json');

export async function recordCommand(argv: string[], io: { log: (s: string) => void }) {
  const dash = argv.indexOf('--');
  const own = dash >= 0 ? argv.slice(0, dash) : argv;
  const wrapped = dash >= 0 ? argv.slice(dash + 1) : [];
  const { values: v, positionals: pos } = parseArgs({
    args: own,
    allowPositionals: true,
    options: { cdp: { type: 'string' }, title: { type: 'string' }, folder: { type: 'string' }, workspace: { type: 'string' }, 'proxy-port': { type: 'string' }, 'max-seconds': { type: 'string' } },
  });
  const sub = pos[0] ?? (wrapped.length ? 'run' : 'start');

  if (sub === 'status') {
    const s = await readFile(statePath(), 'utf8').then((t) => JSON.parse(t) as Json).catch(() => null);
    if (!s) return { recording: false };
    const alive = s.pid && (() => { try { process.kill(s.pid, 0); return true; } catch { return false; } })();
    return { recording: !!alive && !s.result, ...s };
  }
  if (sub === 'stop') {
    const s = await readFile(statePath(), 'utf8').then((t) => JSON.parse(t) as Json).catch(() => null);
    if (!s?.pid) throw new CliError('No recording is running (nib record start --cdp <url>).');
    try {
      process.kill(s.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const now = await readFile(statePath(), 'utf8').then((t) => JSON.parse(t) as Json).catch(() => null);
      if (now?.result || now?.error) {
        await rm(statePath(), { force: true });
        if (now.error) throw new CliError(now.error);
        return now.result;
      }
    }
    throw new CliError('The recorder did not finish within 150 s.');
  }
  if (sub !== 'start' && sub !== 'run') throw new CliError('Use: nib record --cdp <url> -- <command>, nib record start --cdp <url>, nib record stop, nib record status');
  if (!v.cdp) throw new CliError('Pass --cdp <http://host:port> (Chromium started with --remote-debugging-port).');

  const rec = new Recorder(v.cdp.replace(/\/+$/, ''));
  await rec.start(v['proxy-port'] ? Number(v['proxy-port']) : 0);
  io.log(`Recording ${v.cdp}. Drive the browser through the proxy to have input logged: ${rec.proxyUrl}`);
  const opts = { title: v.title, folderId: v.folder, workspaceId: v.workspace };

  if (wrapped.length) {
    const code = await new Promise<number>((resolve) => {
      const child = spawn(wrapped[0]!, wrapped.slice(1), { stdio: 'inherit', env: { ...process.env, NIB_CDP_PROXY: rec.proxyUrl!, NIB_CDP_URL: v.cdp! } });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(127));
    });
    const r = await rec.stop();
    io.log(`Command exited with ${code}. Uploading ${r.stats.frames} frames and ${r.events.length} events.`);
    return { ...(await uploadRecording(r, opts)), commandExitCode: code, proxy: rec.proxyUrl };
  }

  await mkdir(dirname(statePath()), { recursive: true });
  await writeFile(statePath(), JSON.stringify({ pid: process.pid, cdp: v.cdp, proxy: rec.proxyUrl, startedAt: new Date().toISOString() }));
  const max = Number(v['max-seconds'] ?? 1800) * 1000;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once('SIGTERM', done);
    process.once('SIGINT', done);
    setTimeout(done, max).unref();
  });
  try {
    const r = await rec.stop();
    const result = await uploadRecording(r, opts);
    await writeFile(statePath(), JSON.stringify({ pid: process.pid, proxy: rec.proxyUrl, result }));
    return result;
  } catch (e) {
    await writeFile(statePath(), JSON.stringify({ pid: process.pid, error: (e as Error).message }));
    throw e;
  }
}
