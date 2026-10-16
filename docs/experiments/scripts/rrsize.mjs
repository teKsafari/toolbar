// rrweb and events size of one trace: raw and gzip per minute, by rrweb event type and source.
import fs from 'node:fs';
import zlib from 'node:zlib';
const [id, startArg] = process.argv.slice(2);
const SERVER = 'http://localhost:3000';
const H = { authorization: `Bearer ${process.env.TOOLBAR_TOKEN}` };
const dir = `/home/dev/nuru-exp/pull/rr-${id}`;
fs.mkdirSync(dir, { recursive: true });
const get = async (name) => {
  const f = `${dir}/${name}.gz`;
  if (!fs.existsSync(f)) {
    const r = await fetch(`${SERVER}/api/v1/recordings/${id}/media/${name}`, { headers: H });
    if (!r.ok) return null;
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return fs.readFileSync(f);
};
const lines = [];
let gzTotal = 0;
for (let i = 0; ; i++) {
  const b = await get(`rrweb-${String(i).padStart(3, '0')}`) ?? await get(`rrweb-${i}`);
  if (!b) break;
  gzTotal += b.length;
  const text = (b[0] === 0x1f ? zlib.gunzipSync(b) : b).toString('utf8');
  for (const l of text.split('\n')) if (l.trim()) lines.push(l);
}
const ev = await get('events');
const evRaw = ev ? (ev[0] === 0x1f ? zlib.gunzipSync(ev) : ev) : null;
const SRC = ['mutation', 'mousemove', 'mouseinteraction', 'scroll', 'viewport', 'input', 'touchmove', 'media', 'stylesheet', 'canvas', 'font', 'log', 'drag', 'styledecl', 'selection', 'adoptedss', 'customel'];
const TYPES = { 0: 'domcontentloaded', 1: 'load', 2: 'full snapshot', 3: 'incremental', 4: 'meta', 5: 'custom', 6: 'plugin' };
const recs = lines.map((l) => ({ l, e: JSON.parse(l) }));
const t0 = Number(startArg) || recs[0].e.timestamp;
const t1 = recs[recs.length - 1].e.timestamp;
const byKind = {};
const perMin = [];
for (const { l, e } of recs) {
  const k = e.type === 3 ? 'inc:' + (SRC[e.data.source] ?? e.data.source) : TYPES[e.type] ?? String(e.type);
  byKind[k] ??= { n: 0, bytes: 0 };
  byKind[k].n++; byKind[k].bytes += l.length + 1;
  const m = Math.floor((e.timestamp - t0) / 60000);
  (perMin[m] ??= []).push(l);
}
const rawTotal = recs.reduce((a, r) => a + r.l.length + 1, 0);
const minutes = (t1 - t0) / 60000;
const mins = perMin.map((ls, m) => { const raw = ls.join('\n') + '\n'; return { m, events: ls.length, raw: raw.length, gz: zlib.gzipSync(raw).length }; });
const out = { id, minutes: +minutes.toFixed(2), rrweb: { events: recs.length, raw: rawTotal, gzUploaded: gzTotal, rawPerMin: Math.round(rawTotal / minutes), gzPerMin: Math.round(gzTotal / minutes), ratio: +(rawTotal / gzTotal).toFixed(1) }, events: evRaw ? { raw: evRaw.length, gz: ev.length, rawPerMin: Math.round(evRaw.length / minutes), gzPerMin: Math.round(ev.length / minutes), n: evRaw.toString().split('\n').filter(Boolean).length } : null, byKind: Object.fromEntries(Object.entries(byKind).sort((a, b) => b[1].bytes - a[1].bytes)), perMin: mins };
fs.writeFileSync(`${dir}/size.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
