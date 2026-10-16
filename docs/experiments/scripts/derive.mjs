// Re-derive the spans of a trace from its events with another span config.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { deriveTrace } from '/home/dev/toolbar/packages/trace/src/index.ts';
export function loadEvents(file) {
  const b = fs.readFileSync(file);
  const text = (b[0] === 0x1f ? zlib.gunzipSync(b) : b).toString('utf8').trim();
  return text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export function derive(events, config, startedAt, endedAt) {
  return deriveTrace(events, { config, ...(startedAt ? { startedAt } : {}), ...(endedAt ? { endedAt } : {}) }).spans;
}
if (process.argv[2]) {
  const ev = loadEvents(process.argv[2]);
  const spans = derive(ev, {});
  const c = {}; for (const s of spans) c[s.outcome] = (c[s.outcome] ?? 0) + 1;
  console.log(ev.length, 'events', spans.length, 'spans', c);
}
