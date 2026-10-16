import fs from 'node:fs';
const files = process.argv.slice(2);
const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rows = files.map((f) => {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const sec = r.seconds;
  const pb = r.page.byUrl;
  const ext = Object.entries(pb).filter(([k]) => k.startsWith('ext:')).reduce((a, [, v]) => a + v, 0);
  const pageJs = Object.entries(pb).filter(([k]) => k.startsWith('page:')).reduce((a, [, v]) => a + v, 0);
  const long = r.perf.long.map((x) => x[1]);
  const loafExt = r.perf.loaf.filter((l) => l.s.some(([u]) => u.startsWith('chrome-extension://')));
  const extScriptMs = r.perf.loaf.reduce((a, l) => a + l.s.filter(([u]) => u.startsWith('chrome-extension://')).reduce((b, [, d]) => b + d, 0), 0);
  // one interaction = the longest event entry of it; we kept every entry over 16 ms with an interactionId
  const ev = r.perf.events.map((e) => e[1]);
  const max = (k) => Math.max(...r.samples.map((s) => (k(s) ?? 0)));
  return {
    run: r.label, seconds: +sec.toFixed(0),
    mainTaskS: +r.pageMetrics.TaskDuration.toFixed(1), mainScriptS: +r.pageMetrics.ScriptDuration.toFixed(1), layoutS: +r.pageMetrics.LayoutDuration.toFixed(1), styleS: +r.pageMetrics.RecalcStyleDuration.toFixed(1),
    profPageJsS: +(pageJs / 1000).toFixed(1), profExtS: +(ext / 1000).toFixed(1), profProgramS: +((pb['(program)'] ?? 0) / 1000).toFixed(1), profGcS: +((pb['(garbage collector)'] ?? pb['(gc)'] ?? 0) / 1000).toFixed(1),
    swBusyS: +(r.sw.busyMs / 1000).toFixed(1),
    cpu: Object.fromEntries(Object.entries(r.cpuBy).filter(([, v]) => v > 0.05).map(([k, v]) => [k, +v.toFixed(1)])),
    longTasks: long.length, longMs: long.reduce((a, b) => a + b, 0), longP95: q(long, 0.95), longMax: Math.max(0, ...long),
    loaf: r.perf.loaf.length, loafBlockingMs: r.perf.loaf.reduce((a, l) => a + l.b, 0), loafWithExt: loafExt.length, extScriptInLoafMs: extScriptMs,
    events16: ev.length, evP75: q(ev, 0.75), evP98: q(ev, 0.98), evMax: Math.max(0, ...ev),
    heapMaxMB: +(max((s) => s.heap) / 1e6).toFixed(1), swHeapMaxMB: +(max((s) => s.swHeap) / 1e6).toFixed(1),
    rssRendererMaxMB: +(max((s) => s.rss.renderer) / 1e6).toFixed(0), rssExtMaxMB: +(max((s) => s.rss.extension) / 1e6).toFixed(0), rssBrowserMaxMB: +(max((s) => s.rss.browser) / 1e6).toFixed(0),
    stopMs: r.stopMs ?? null, recordingId: r.recordingId ?? null,
    extFns: Object.entries(r.page.extFns ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1000).toFixed(2)}s`),
  };
});
console.log(JSON.stringify(rows, null, 1));
