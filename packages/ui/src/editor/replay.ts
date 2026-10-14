// DOM replay preview for instant-replay drafts (J-009, J-010, J-240): an rrweb Replayer scaled
// to fit the preview, driven by the same play, seek and trim controls as a video draft.
// Times are draft-relative ms (0 = draft.startedAt), the clock the trim range uses.
import { Replayer } from '@rrweb/replay';

type RrwebEvent = { type: number; timestamp: number; data?: unknown };

/** Parse an NDJSON blob of rrweb events; bad lines are skipped. */
export function parseNdjson(text: string): RrwebEvent[] {
  const out: RrwebEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as RrwebEvent;
      if (e && typeof e.timestamp === 'number' && typeof e.type === 'number') out.push(e);
    } catch {
      /* a torn line */
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/** Offset of the first replay event from the draft's start, so draft time maps to replay time. */
export function replayOffsetMs(events: { timestamp: number }[], startedAt: number | null | undefined): number {
  if (!events.length || !startedAt) return 0;
  return Math.max(0, events[0]!.timestamp - startedAt);
}

export class ReplayDriver {
  private replayer: Replayer;
  private ro: ResizeObserver;
  private size = { w: 0, h: 0 };
  readonly offsetMs: number;
  readonly totalMs: number;
  playing = false;
  onfinish: (() => void) | null = null;

  constructor(
    private stage: HTMLElement,
    events: RrwebEvent[],
    startedAt: number | null | undefined,
  ) {
    this.offsetMs = replayOffsetMs(events, startedAt);
    this.replayer = new Replayer(events as never, {
      root: stage,
      mouseTail: false,
      skipInactive: false,
      showWarning: false,
      triggerFocus: false,
      insertStyleRules: ['html { cursor: default; }'],
    });
    this.totalMs = this.offsetMs + this.replayer.getMetaData().totalTime;
    this.replayer.on('resize', (d) => {
      const { width, height } = d as { width: number; height: number };
      this.size = { w: width, h: height };
      this.fit();
    });
    this.replayer.on('finish', () => {
      this.playing = false;
      this.onfinish?.();
    });
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(stage);
    const ifr = this.replayer.iframe;
    if (ifr.width && ifr.height) this.size = { w: Number(ifr.width), h: Number(ifr.height) };
    this.fit();
    this.replayer.pause(0);
  }

  /** Scale the recorded viewport to fit the stage, centred. */
  fit() {
    const w = this.replayer.wrapper;
    const { w: vw, h: vh } = this.size;
    if (!vw || !vh) return;
    const r = this.stage.getBoundingClientRect();
    const k = Math.min(r.width / vw, r.height / vh);
    w.style.position = 'absolute';
    w.style.left = `${(r.width - vw * k) / 2}px`;
    w.style.top = `${(r.height - vh * k) / 2}px`;
    w.style.transformOrigin = '0 0';
    w.style.transform = `scale(${k})`;
  }

  get currentMs(): number {
    return this.offsetMs + this.replayer.getCurrentTime();
  }

  private toReplay(ms: number) {
    return Math.max(0, Math.min(ms - this.offsetMs, this.totalMs - this.offsetMs));
  }

  play(fromMs: number) {
    this.replayer.play(this.toReplay(fromMs));
    this.playing = true;
  }

  pause() {
    this.replayer.pause();
    this.playing = false;
  }

  seek(ms: number) {
    this.replayer.pause(this.toReplay(ms));
    this.playing = false;
  }

  destroy() {
    this.ro.disconnect();
    try {
      this.replayer.pause();
      this.replayer.destroy();
    } catch {
      /* already torn down */
    }
  }
}
