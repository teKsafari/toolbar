// Experiment 2: hand labels against the span outcomes, for one or more span configs.
// tsx compare.mjs <events.gz> <startedAt> <endedAt> [configs.json]
import fs from 'node:fs';
import { loadEvents, derive } from './derive.mjs';
const [evFile, startArg, endArg, cfgFile] = process.argv.slice(2);
const DIR = '/home/dev/nuru-exp/exp2';
const read = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const actions = read(`${DIR}/actions.jsonl`).sort((a, b) => a.n - b.n);
const labels = new Map(read(`${DIR}/labels.jsonl`).map((l) => [l.n, l])); // the last label of an action wins
const events = loadEvents(evFile);
const startedAt = Number(startArg), endedAt = Number(endArg);
const OUT = ['changed', 'error', 'dead', 'stuck', 'silent'];
// the text each run printed, to check that the span holds the visible result (late output)
// how long after the click each run's output appeared (the terminal's own timing line, plus paint)
const RESULT_MS = { 3: 33, 6: 35, 15: 3153, 17: 1270, 27: 50, 29: 47 };

function match(spans, a, next) {
  const page = spans.filter((s) => s.outcome !== 'note');
  if (a.action.do === 'editor' || a.action.do === 'type') {
    const until = next ? next.tAct + 1500 : Infinity;
    return page.find((s) => s.action.type === 'input' && s.t0 >= a.tAct && s.t0 <= until) ?? null;
  }
  const types = a.action.do === 'key' ? ['key', 'nav'] : ['click', 'dblclick', 'contextmenu', 'nav'];
  return page.filter((s) => types.includes(s.action.type) && s.t0 >= a.tAct - 150 && s.t0 <= a.tAct + 1500).sort((x, y) => Math.abs(x.t0 - a.tAct) - Math.abs(y.t0 - a.tAct))[0] ?? null;
}

export function score(config) {
  const spans = derive(events, config, startedAt, endedAt);
  const rows = actions.map((a, i) => {
    const s = match(spans, a, actions[i + 1]);
    const hand = labels.get(a.n)?.label ?? '?';
    const got = s ? s.outcome : 'none';
    const want = RESULT_MS[a.n];
    const result = want !== undefined ? !!s && s.t1 >= s.t0 + want : null;
    const strict = (labels.get(a.n)?.notes.match(/\[strict:(\w+)\]/) ?? [])[1] ?? hand;
    return { n: a.n, hand, strict, got, ok: hand === got, okStrict: strict === got, result, span: s ? `${s.id} ${s.summary}`.slice(0, 200) : null, close: s?.closeReason, ms: s?.durationMs };
  });
  const confusion = {};
  for (const h of OUT) confusion[h] = Object.fromEntries([...OUT, 'none'].map((g) => [g, 0]));
  for (const r of rows) if (confusion[r.hand]) confusion[r.hand][r.got]++;
  const ok = rows.filter((r) => r.ok).length;
  const okStrict = rows.filter((r) => r.okStrict).length;
  const withResult = rows.filter((r) => r.result !== null);
  const results = withResult.filter((r) => r.result).length;
  return { config, agreement: ok / rows.length, ok, okStrict, total: rows.length, results, resultsOf: withResult.length, rows, confusion, spans: spans.length };
}

const configs = cfgFile ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : [{}];
const results = configs.map((c) => score(c));
if (configs.length === 1) {
  const r = results[0];
  for (const x of r.rows) console.log(String(x.n).padStart(2), x.ok ? ' ' : 'X', x.result === null ? ' ' : x.result ? 'R' : 'r', x.hand.padEnd(8), x.got.padEnd(8), (x.close ?? '').padEnd(9), String(x.ms ?? '').padStart(6), x.span ?? '');
  console.log('agreement', r.ok, '/', r.total, (100 * r.agreement).toFixed(0) + '%', 'strict', r.okStrict, '/', r.total, 'results in span', r.results, '/', r.resultsOf);
  console.log('hand \\ spans', [...OUT, 'none'].join(' '));
  for (const h of OUT) console.log(h.padEnd(8), Object.values(r.confusion[h]).join(' '));
} else {
  for (const r of results.sort((a, b) => b.agreement - a.agreement || b.results - a.results)) console.log((100 * r.agreement).toFixed(0).padStart(3) + '%', 'strict', r.okStrict, 'results', `${r.results}/${r.resultsOf}`, JSON.stringify(r.config));
}
fs.writeFileSync(`${DIR}/compare-${Date.now()}.json`, JSON.stringify(results, null, 1));
