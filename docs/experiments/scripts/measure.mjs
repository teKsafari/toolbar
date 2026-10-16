// Cost measurement on our own Chromium (CDP 9462): page metrics, long tasks and LoAF, CPU profiles
// of the page and the extension worker, process CPU and RSS from /proc.
import fs from 'node:fs';
import { cdpConnect } from './cdp.mjs';

const EXT = 'chrome-extension://fmongfmimgdafigcahdpofnmmhljpnei/';
const OBSERVER = `(() => {
  if (window.__perfx) return;
  const x = window.__perfx = { long: [], loaf: [], events: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) x.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) x.loaf.push({ d: Math.round(e.duration), b: Math.round(e.blockingDuration), s: e.scripts.map((s) => [String(s.sourceURL || s.invoker || '').slice(0, 120), Math.round(s.duration)]) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) x.events.push([e.name, Math.round(e.duration), Math.round(e.processingEnd - e.processingStart), Math.round(e.processingStart - e.startTime)]); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
})()`;

function procs() {
  const out = [];
  for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(/[\0 ]/);
      if (!cmd[0].includes('chrome-linux64/')) continue; // only our browser's tree counts, below
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ppid = Number(f[1]);
      const cpu = (Number(f[11]) + Number(f[12])) / 100; // utime + stime, seconds (CLK_TCK 100)
      const rss = Number(fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096;
      const type = (cmd.find((a) => a.startsWith('--type=')) ?? '--type=browser').slice(7);
      const kind = type === 'renderer' ? (cmd.includes('--extension-process') ? 'extension' : 'renderer') : type === 'utility' ? 'utility:' + ((cmd.find((a) => a.startsWith('--utility-sub-type=')) ?? '').split('.').pop()) : type;
      out.push({ pid: Number(pid), ppid, cpu, rss, kind });
    } catch {}
  }
  return out;
}

export async function startMeasure({ pageTargetUrl = 'https://116.nuru.sh', label }) {
  const c = await cdpConnect();
  const { targetInfos } = await c.send('Target.getTargets');
  const pageT = targetInfos.find((t) => t.type === 'page' && t.url.startsWith(pageTargetUrl));
  const { sessionId: ps } = await c.send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });
  await c.send('Page.enable', {}, ps);
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER }, ps);
  await c.send('Runtime.evaluate', { expression: OBSERVER }, ps);
  await c.send('Performance.enable', { timeDomain: 'threadTicks' }, ps);
  await c.send('Profiler.enable', {}, ps);
  await c.send('Profiler.setSamplingInterval', { interval: 1000 }, ps);
  await c.send('Profiler.start', {}, ps);
  let swS = null;
  const swT = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(EXT));
  if (swT) {
    ({ sessionId: swS } = await c.send('Target.attachToTarget', { targetId: swT.targetId, flatten: true }));
    await c.send('Profiler.enable', {}, swS);
    await c.send('Profiler.setSamplingInterval', { interval: 1000 }, swS);
    await c.send('Profiler.start', {}, swS);
  }
  // our root browser pid: the chrome.pid file; only its descendants count
  const root = Number(fs.readFileSync('/home/dev/nuru-exp/chrome.pid', 'utf8'));
  const mine = () => { const ps_ = procs(); const set = new Set([root]); let grew = true; while (grew) { grew = false; for (const p of ps_) if (!set.has(p.pid) && set.has(p.ppid)) { set.add(p.pid); grew = true; } } return ps_.filter((p) => set.has(p.pid)); };
  const first = new Map(); const last = new Map();
  for (const p of mine()) { first.set(p.pid, p); last.set(p.pid, p); }
  const samples = [];
  const metrics0 = Object.fromEntries((await c.send('Performance.getMetrics', {}, ps)).metrics.map((m) => [m.name, m.value]));
  const metricAcc = { TaskDuration: 0, ScriptDuration: 0, LayoutDuration: 0, RecalcStyleDuration: 0 };
  let prevM = metrics0;
  const perf = { long: [], loaf: [], events: [] };
  const segs = { page: [], sw: [] };
  const t0 = Date.now();
  async function sample() {
    const now = (Date.now() - t0) / 1000;
    const pl = mine();
    for (const p of pl) { if (!first.has(p.pid)) first.set(p.pid, { ...p, cpu: 0 }); last.set(p.pid, p); }
    let m = null;
    try { m = Object.fromEntries((await c.send('Performance.getMetrics', {}, ps)).metrics.map((x) => [x.name, x.value])); } catch {}
    if (m) {
      for (const k of Object.keys(metricAcc)) { const d = m[k] - (prevM[k] ?? 0); metricAcc[k] += d >= 0 ? d : m[k]; }
      prevM = m;
    }
    try {
      const r = await c.send('Runtime.evaluate', { expression: 'JSON.stringify((() => { const x = window.__perfx; if (!x) return null; const o = { long: x.long.splice(0), loaf: x.loaf.splice(0), events: x.events.splice(0) }; return o; })())', returnByValue: true }, ps);
      const v = r.result.value && JSON.parse(r.result.value);
      if (v) { perf.long.push(...v.long); perf.loaf.push(...v.loaf); perf.events.push(...v.events); }
    } catch {}
    let swHeap = null;
    if (swS) try { swHeap = (await c.send('Runtime.getHeapUsage', {}, swS)).usedSize; } catch {}
    const rssBy = {};
    for (const p of pl) rssBy[p.kind] = (rssBy[p.kind] ?? 0) + p.rss;
    samples.push({ t: now, heap: m?.JSHeapUsedSize ?? null, swHeap, rss: rssBy });
  }
  const timer = setInterval(() => void sample(), 5000);
  async function cut() {
    // close the current profile segment and start a new one (profiles stay small)
    for (const [k, s] of [['page', ps], ['sw', swS]]) {
      if (!s) continue;
      try { const { profile } = await c.send('Profiler.stop', {}, s); segs[k].push(summarizeProfile(profile)); await c.send('Profiler.start', {}, s); } catch (e) { segs[k].push({ error: e.message }); }
    }
  }
  const cutTimer = setInterval(() => void cut(), 60000);
  return {
    async stop(extra = {}) {
      clearInterval(timer); clearInterval(cutTimer);
      await sample();
      for (const [k, s] of [['page', ps], ['sw', swS]]) {
        if (!s) continue;
        try { const { profile } = await c.send('Profiler.stop', {}, s); segs[k].push(summarizeProfile(profile)); } catch (e) { segs[k].push({ error: e.message }); }
      }
      const cpuBy = {};
      for (const [pid, p] of last) { const f = first.get(pid); cpuBy[p.kind] = (cpuBy[p.kind] ?? 0) + (p.cpu - f.cpu); }
      const prof = (k) => segs[k].reduce((a, s) => { if (s.error) { a.errors++; return a; } a.busyMs += s.busyMs; a.totalMs += s.totalMs; for (const [u, ms] of Object.entries(s.byUrl)) a.byUrl[u] = (a.byUrl[u] ?? 0) + ms; for (const [u, ms] of Object.entries(s.extFns)) a.extFns[u] = (a.extFns[u] ?? 0) + ms; return a; }, { busyMs: 0, totalMs: 0, byUrl: {}, extFns: {}, errors: 0 });
      const res = { label, seconds: (Date.now() - t0) / 1000, pageMetrics: metricAcc, cpuBy, page: prof('page'), sw: prof('sw'), perf, samples, ...extra };
      c.close();
      return res;
    },
  };
}

/** Busy time of a CPU profile, by owner: the nearest frame with a script URL (extension, page). */
export function summarizeProfile(p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const ownerCache = new Map();
  const keyOf = (url) => url.startsWith('chrome-extension://') ? 'ext:' + url.split('/').slice(3).join('/').slice(0, 60) : url.startsWith('http') ? 'page:' + new URL(url).hostname : 'other:' + url.slice(0, 50);
  const owner = (id) => {
    if (ownerCache.has(id)) return ownerCache.get(id);
    let cur = id, o = null;
    while (cur !== undefined) { const n = byId.get(cur); if (n.callFrame.url) { o = keyOf(n.callFrame.url); break; } cur = parent.get(cur); }
    ownerCache.set(id, o);
    return o;
  };
  const byUrl = {};
  const extFns = {};
  let busy = 0, total = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.timeDeltas[i + 1] ?? 0) / 1000;
    total += dt;
    const n = byId.get(p.samples[i]);
    const name = n.callFrame.functionName;
    if (name === '(idle)') continue;
    if (name === '(program)' || name === '(garbage collector)') { byUrl[name] = (byUrl[name] ?? 0) + dt; busy += dt; continue; }
    busy += dt;
    const key = owner(n.id) ?? 'native:' + name.slice(0, 30);
    byUrl[key] = (byUrl[key] ?? 0) + dt;
    if (key.startsWith('ext:')) { const f = `${name || '(anon)'}@${n.callFrame.lineNumber}`; extFns[f] = (extFns[f] ?? 0) + dt; }
  }
  return { busyMs: busy, totalMs: total, byUrl, extFns };
}
