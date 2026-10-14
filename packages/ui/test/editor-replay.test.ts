import { describe, expect, it } from 'vitest';
import { parseNdjson, replayOffsetMs } from '../src/editor/replay.ts';

describe('replay draft helpers', () => {
  it('parses NDJSON rrweb events, skips torn lines and sorts by time', () => {
    const text = ['{"type":3,"timestamp":20}', '{"type":4,"timestamp":10,"data":{}}', '{"type":3,"times', '', '{"nope":1}'].join('\n');
    expect(parseNdjson(text).map((e) => e.timestamp)).toEqual([10, 20]);
  });
  it('lines replay time up with the draft start', () => {
    expect(replayOffsetMs([{ timestamp: 1500 }], 1000)).toBe(500);
    expect(replayOffsetMs([{ timestamp: 900 }], 1000)).toBe(0);
    expect(replayOffsetMs([{ timestamp: 900 }], null)).toBe(0);
    expect(replayOffsetMs([], 1000)).toBe(0);
  });
});
