// GET /recordings/:id/status: server-sent events, one { status, progress, error } per change,
// closed after ready or failed (J-034, J-087). Polls the row once a second; a comment line every
// 15 s keeps proxies from closing the stream.
import type { RecordingStatus } from '@toolbar/shared';

export interface StatusRow {
  status: RecordingStatus;
  progress: number | null;
  error: string | null;
  deletedAt: Date | null;
}

export function statusStream(read: () => Promise<StatusRow | null>, signal: AbortSignal, pollMs = 1000): Response {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let last = '';
      let sinceBeat = 0;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener('abort', close);
      const step = async () => {
        if (closed) return;
        try {
          const r = await read();
          const ev = !r || r.deletedAt ? { status: 'failed', progress: null, error: 'deleted' } : { status: r.status, progress: r.progress, error: r.error };
          const s = JSON.stringify(ev);
          if (s !== last) {
            last = s;
            ctrl.enqueue(enc.encode(`event: status\ndata: ${s}\n\n`));
          } else if ((sinceBeat += pollMs) >= 15_000) {
            sinceBeat = 0;
            ctrl.enqueue(enc.encode(`: keep-alive\n\n`));
          }
          if (ev.status === 'ready' || ev.status === 'failed') return close();
        } catch (e) {
          ctrl.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ message: (e as Error).message })}\n\n`));
          return close();
        }
        timer = setTimeout(step, pollMs);
      };
      await step();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' },
  });
}
