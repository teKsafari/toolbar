// Live check of the hosted path (D-087) on the two FLEURS fixtures: decode, chunk, one
// `gpt-transcribe` request each, cues built by the server. Skipped unless TRANSCRIBE_LIVE_TEST=1
// and TRANSCRIBE_API_KEY or OPENAI_API_KEY are set. Costs about $0.002 a run (29 s of audio at
// $0.0045 a minute). Needs ffmpeg.
//
//   TRANSCRIBE_LIVE_TEST=1 pnpm --filter @toolbar/server exec vitest run test/transcribe.live.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transcribeConfig } from '../src/lib/server/transcribe/config.ts';
import { openAiCompatible } from '../src/lib/server/transcribe/index.ts';
import { memoryLedger, monthOf, runTranscription } from '../src/lib/server/transcribe/run.ts';
import { parseVtt } from '../src/lib/server/transcribe/vtt.ts';

const FIX = new URL('../fixtures/transcribe/', import.meta.url).pathname;
const live = process.env.TRANSCRIBE_LIVE_TEST === '1' && !!(process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY);

const clips = [
  {
    file: 'fleurs-sw_ke-1999.webm',
    lang: 'sw',
    ms: 18_008,
    ref: 'Katika miaka yote ya 1960, Brzezinski alimfanyia kazi John F. Kennedy kama mshauri wake na pia utawala wa Lyndon B. Johnson.',
    // the year spelled out is as right as the digits (models write either)
    alt: ['Katika miaka yote ya elfu moja mia tisa sitini, Brzezinski alimfanyia kazi John F. Kennedy kama mshauri wake na pia utawala wa Lyndon B. Johnson.'],
  },
  {
    file: 'fleurs-en_us-1904.webm',
    lang: 'en',
    ms: 10_568,
    ref: 'However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.',
    alt: [] as string[],
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Character error rate: edit distance over the reference length. */
function cer(ref: string, hyp: string): number {
  const a = norm(ref);
  const b = norm(hyp);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]! / a.length;
}

describe.skipIf(!live)('hosted transcription, live', () => {
  for (const c of clips) {
    it(`${c.file}: detects ${c.lang}, CER under 25%, cues inside the clip`, async () => {
      const cfg = { ...transcribeConfig(), provider: 'openai' as const, timestamps: 'auto' as const, chunkSeconds: 30 };
      const t = openAiCompatible(cfg);
      const ledger = memoryLedger();
      const out = await runTranscription(t, { audio: readFileSync(`${FIX}${c.file}`), mime: 'audio/webm', durationMs: c.ms }, { maxMinutes: 60, monthlyMinutes: 1 }, ledger);
      expect(out.status).toBe('done');
      if (out.status !== 'done') return;
      const r = out.result;
      const cues = parseVtt(r.vtt);
      const text = cues.map((x) => x.text).join(' ');
      const score = Math.min(...[c.ref, ...c.alt].map((ref) => cer(ref, text)));
      process.stdout.write(`[live] ${c.file} model=${r.model} mode=${r.mode} language=${r.language} billed=${r.billedSeconds}s CER=${(score * 100).toFixed(1)}%\n[live]   ${text}\n`);
      expect(r.mode).toBe('chunked');
      expect(r.language?.split(',')).toContain(c.lang);
      expect(score).toBeLessThan(0.25);
      expect(cues.length).toBeGreaterThan(0);
      for (const x of cues) {
        expect(x.startMs).toBeGreaterThanOrEqual(0);
        expect(x.endMs).toBeLessThanOrEqual(c.ms + 50);
        expect(x.endMs).toBeGreaterThan(x.startMs);
      }
      expect(r.billedSeconds).toBeGreaterThan(0);
      expect(ledger.months[monthOf()]).toBe(r.billedSeconds);
    }, 120_000);
  }
});
