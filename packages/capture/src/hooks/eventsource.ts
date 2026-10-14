// EventSource streams (J-063). Better than the reference: the messages are kept, including
// named events the page listens for.
import type { HookInstaller } from '../transport.ts';
import { absoluteUrl, cap, quiet, replaceProp, wrapCtor, wrapFn } from './util.ts';
import { WS_FRAME_MAX } from './websocket.ts';

export const installEventSourceHook: HookInstaller = (emit, win) => {
  const ES = win.EventSource;
  if (typeof ES !== 'function') return () => {};
  const ids = new WeakMap<EventSource, { sid: string; types: Set<string> }>();
  let n = 0;
  const prefix = Math.random().toString(36).slice(2, 6);

  const listen = (es: EventSource, sid: string, type: string) => {
    const meta = ids.get(es);
    if (!meta || meta.types.has(type)) return;
    meta.types.add(type);
    addListener.call(es, type, ((e: MessageEvent) =>
      quiet(() => {
        const c = cap(String(e.data ?? ''), WS_FRAME_MAX);
        emit('sse', { sid, op: 'message', ...(type !== 'message' ? { event: type } : {}), data: c.text, ...(e.lastEventId ? { lastEventId: e.lastEventId } : {}) });
      })) as EventListener);
  };

  const addListener = ES.prototype.addEventListener;
  const Wrapped = wrapCtor(ES, (es, args) => {
    const sid = `sse-${prefix}-${(n++).toString(36)}`;
    ids.set(es, { sid, types: new Set() });
    const url = absoluteUrl(String(args[0]));
    emit('sse', { sid, op: 'open', url });
    addListener.call(es, 'open', () => quiet(() => emit('sse', { sid, op: 'open', url, event: 'connected' })));
    addListener.call(es, 'error', () =>
      quiet(() => emit('sse', { sid, op: es.readyState === 2 ? 'close' : 'error' })),
    );
    listen(es, sid, 'message');
  });
  const wAdd = wrapFn(addListener, (target, es, args) => {
    quiet(() => {
      const meta = ids.get(es as EventSource);
      const type = String(args[0]);
      if (meta && type !== 'open' && type !== 'error') listen(es as EventSource, meta.sid, type);
    });
    return Reflect.apply(target, es, args) as void;
  });
  const close = ES.prototype.close;
  const wClose = wrapFn(close, (target, es, args) => {
    quiet(() => {
      const meta = ids.get(es as EventSource);
      if (meta && (es as EventSource).readyState !== 2) emit('sse', { sid: meta.sid, op: 'close' });
    });
    return Reflect.apply(target, es, args) as void;
  });
  const r1 = replaceProp(win, 'EventSource', Wrapped);
  const r2 = replaceProp(ES.prototype, 'addEventListener', wAdd);
  const r3 = replaceProp(ES.prototype, 'close', wClose);
  return () => {
    r3();
    r2();
    r1();
  };
};
