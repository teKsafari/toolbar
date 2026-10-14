// rrweb DOM recording in the isolated world (architecture s10, D-013). Runs only while a
// recording is attached or the instant-replay ring is on. Full snapshot every 30 s so the ring
// can be pruned to the last checkout. The toolbar host is blocked; inputs are masked per preset.
import { record } from '@rrweb/record';
import { LIMITS, type MaskingPreset } from '@toolbar/shared';
import { UI_HOST_TAG } from '@toolbar/shared/constants';

/** rrweb event type of a full snapshot (EventType.FullSnapshot). */
export const RRWEB_FULL_SNAPSHOT = 2;
export const RRWEB_META = 4;

export interface RrwebRecorder {
  readonly running: boolean;
  start(preset?: MaskingPreset): void;
  stop(): void;
  checkout(): void;
  flush(): void;
}

export function createRrwebRecorder(send: (batch: unknown[], full: boolean) => void, flushMs = 1000): RrwebRecorder {
  let stopFn: (() => void) | undefined;
  let buf: unknown[] = [];
  let full = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!buf.length) return;
    const b = buf;
    const f = full;
    buf = [];
    full = false;
    send(b, f);
  };

  return {
    get running() {
      return !!stopFn;
    },
    start(preset: MaskingPreset = 'staging') {
      if (stopFn) return;
      try {
        stopFn =
          record({
            emit(e) {
              buf.push(e);
              if ((e as { type: number }).type === RRWEB_FULL_SNAPSHOT) {
                full = true;
                flush(); // full snapshots go out at once, so the ring always has a cut point
                return;
              }
              timer ??= setTimeout(flush, flushMs);
            },
            checkoutEveryNms: LIMITS.rrwebCheckoutMs,
            blockSelector: UI_HOST_TAG,
            maskAllInputs: preset === 'production',
            maskInputOptions: { password: true, email: true, tel: true },
            maskTextSelector: preset === 'production' ? '*' : undefined,
            blockClass: 'nib-block',
            sampling: { mousemove: 50, scroll: 150, input: 'last', media: 800 },
            inlineStylesheet: true,
            recordCrossOriginIframes: false,
            collectFonts: false,
          }) ?? undefined;
      } catch {
        stopFn = undefined;
      }
    },
    stop() {
      flush();
      stopFn?.();
      stopFn = undefined;
    },
    checkout() {
      if (!stopFn) return;
      try {
        record.takeFullSnapshot(true);
      } catch {
        /* recorder not ready */
      }
    },
    flush,
  };
}
