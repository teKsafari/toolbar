// ISOLATED world entry, run at document_start. Receives page events over the bridge,
// will apply redaction and the ring buffer (capture area), then hands batches to a Transport.
import type { CaptureEvent } from '@toolbar/shared';
import { acceptMainBridge } from './bridge.ts';
import type { Transport } from './transport.ts';

export interface StartIsolatedOptions {
  transport: Transport;
  win?: Window;
  /** Batch window in ms. Events within it go out in one send(). */
  batchMs?: number;
}

export function startIsolatedWorld({ transport, win = window, batchMs = 50 }: StartIsolatedOptions) {
  let pending: CaptureEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let received = 0;
  const flush = () => {
    timer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    transport.send(batch);
  };
  const bridge = acceptMainBridge((data) => {
    received++;
    // TODO(capture area): redact (headers, password fields, JWTs, emails, cards) before it leaves the page.
    pending.push(data as CaptureEvent);
    timer ??= setTimeout(flush, batchMs);
  }, win);
  transport.onCommand((c) => {
    if (c.type === 'flush') flush();
  });
  return {
    flush,
    get connected() {
      return bridge.connected;
    },
    get received() {
      return received;
    },
  };
}
