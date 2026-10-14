// comments.stream: server-sent events so viewers see each other's comments live (J-133).
import { handle, viewerAccess } from '#lib/server/viewer/access.ts';
import { getComment, reactionsOf, subscribe, type CommentSignal } from '#lib/server/viewer/comments.ts';

export const GET = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!, { token: event.url.searchParams.get('share') });
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      controller.enqueue(enc.encode(': open\nretry: 3000\n\n'));
      const onSignal = async (s: CommentSignal) => {
        if (s.type === 'deleted') return send({ type: 'deleted', id: s.id });
        if (s.type === 'reactions') return send({ type: 'reactions', id: s.id, reactions: (await reactionsOf([s.id], ctx.actor)).get(s.id) ?? [] });
        const c = await getComment(ctx, s.id);
        if (c) send({ type: s.type, comment: c });
      };
      const off = subscribe(ctx.rec.id, (s) => void onSignal(s).catch(() => {}));
      const ping = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 25_000);
      stop = () => {
        off();
        clearInterval(ping);
      };
      event.request.signal.addEventListener('abort', () => {
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' } });
});
