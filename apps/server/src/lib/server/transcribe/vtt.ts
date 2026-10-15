// WebVTT parsing and building. The gpt-* transcription models return text only, so the server
// times the cues itself: each chunk's text is split into sentences that are spread over the
// chunk's voiced time by their share of the characters (docs/research/transcription.md, step 5).
import type { Pause } from './chunk.ts';

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

export function normaliseVtt(text: string): string {
  const t = text.replace(/\r\n/g, '\n').trim();
  return (t.startsWith('WEBVTT') ? t : `WEBVTT\n\n${t}`) + '\n';
}

const ts = (s: string) => {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return NaN;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, '0'));
};

/** Parse WebVTT cues (timing lines and their text); ignores NOTE and STYLE blocks. */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i]!.split('-->');
    const startMs = ts(a!);
    const endMs = ts(z!.trim().split(/\s+/)[0]!);
    const text = lines
      .slice(i + 1)
      .join('\n')
      .trim();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && text) cues.push({ startMs, endMs, text });
  }
  return cues;
}

export function formatTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

/** WebVTT text of cues. A cue line never contains "-->" (that would start a new timing line). */
export function buildVtt(cues: Cue[], notes: string[] = []): string {
  const head = ['WEBVTT', ...notes.map((n) => `\nNOTE ${n.replace(/-->/g, '->').replace(/\n+/g, ' ')}`)].join('\n');
  const body = cues.map((c) => `${formatTime(c.startMs)} --> ${formatTime(c.endMs)}\n${c.text.replace(/-->/g, '->').replace(/\n{2,}/g, '\n')}`).join('\n\n');
  return body ? `${head}\n\n${body}\n` : `${head}\n`;
}

/** Plain text of a WebVTT document, one cue per line. */
export const vttPlainText = (vtt: string) =>
  parseVtt(vtt)
    .map((c) => c.text)
    .join('\n');

// ---------- text to cues ----------

/** Sentences of a chunk's text: split after . ! ? and their full-width forms, and after line breaks. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?。！？…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split a sentence that would last longer than maxMs at commas, then at word boundaries. */
function splitLong(s: string, ms: number, maxMs: number): string[] {
  // pieces keep at least about 30 characters: a short sentence over a long stretch of audio is a
  // slow speaker or a long pause, and one-word cues would read worse than one long cue
  const parts = Math.min(Math.ceil(ms / maxMs), Math.floor(s.length / 30));
  if (parts <= 1) return [s];
  const target = s.length / parts;
  const byComma = s.split(/(?<=[,;:،，])\s+/);
  const pieces = byComma.length > 1 ? byComma : s.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const next = cur ? `${cur} ${p}` : p;
    if (cur && next.length > target * 1.15) {
      out.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Cues for one chunk's text. `voiced` are the voiced spans of the chunk (seconds from the start
 * of the file), so the cue times line up with the recording. Cues stay under about `maxCueMs`.
 */
export function cuesForChunk(text: string, chunk: { start: number; end: number; voiced: Pause[] }, maxCueMs = 7000): Cue[] {
  const voiced = chunk.voiced.length ? chunk.voiced : [{ start: chunk.start, end: chunk.end }];
  const total = voiced.reduce((n, v) => n + (v.end - v.start), 0) || chunk.end - chunk.start;
  const at = (frac: number) => {
    let need = Math.min(1, Math.max(0, frac)) * total;
    for (const v of voiced) {
      const len = v.end - v.start;
      if (need <= len) return v.start + need;
      need -= len;
    }
    return voiced[voiced.length - 1]!.end;
  };
  // first pass by sentence, then split sentences that run long
  const sents = sentences(text);
  const chars = sents.reduce((n, s) => n + s.length, 0);
  if (!chars) return [];
  const pieces: string[] = [];
  for (const s of sents) pieces.push(...splitLong(s, (s.length / chars) * total * 1000, maxCueMs));
  const all = pieces.reduce((n, s) => n + s.length, 0);
  const out: Cue[] = [];
  let acc = 0;
  for (const p of pieces) {
    const a = at(acc / all);
    acc += p.length;
    const z = at(acc / all);
    out.push({ startMs: Math.round(a * 1000), endMs: Math.max(Math.round(a * 1000) + 300, Math.round(z * 1000)), text: p });
  }
  // keep cues in order and apart
  for (let i = 1; i < out.length; i++) if (out[i]!.startMs < out[i - 1]!.endMs) out[i - 1]!.endMs = Math.max(out[i - 1]!.startMs + 1, out[i]!.startMs);
  return out;
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Drop the words at the start of `next` that repeat the end of `prev` (a hard cut gives the two
 * chunks about one second of shared audio). Matches 1 to 12 words, longest first.
 */
export function dropOverlap(prev: string, next: string): string {
  const a = prev.split(/\s+/).filter(Boolean);
  const b = next.split(/\s+/).filter(Boolean);
  for (let k = Math.min(12, a.length, b.length); k >= 1; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (norm(a[a.length - k + i]!) !== norm(b[i]!) || !norm(b[i]!)) {
        same = false;
        break;
      }
    }
    // one shared short word is as likely a coincidence as an overlap
    if (same && (k > 1 || norm(b[0]!).length > 3)) return b.slice(k).join(' ');
  }
  return next;
}

/** Shift the cues of a chunk's own VTT (native-timestamp models) to the chunk's place in the file. */
export function offsetCues(cues: Cue[], offsetMs: number, notBeforeMs = 0): Cue[] {
  return cues.map((c) => ({ ...c, startMs: c.startMs + offsetMs, endMs: c.endMs + offsetMs })).filter((c) => c.startMs >= notBeforeMs - 200);
}
