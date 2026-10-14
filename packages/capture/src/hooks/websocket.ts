// WebSocket open, frames in both directions, close and error (J-062, J-066).
// Text frames keep their data (capped); binary frames keep only their size.
import { LIMITS } from '@toolbar/shared';
import type { HookInstaller } from '../transport.ts';
import { absoluteUrl, cap, quiet, replaceProp, utf8Length, wrapCtor, wrapFn } from './util.ts';

/** Per-frame cap; frames are many and small, so this is lower than the body cap. */
export const WS_FRAME_MAX = 64 * 1024;

export function frameData(data: unknown): { data?: string; truncated?: boolean; binary?: boolean; length?: number } {
  if (typeof data === 'string') {
    const c = cap(data, Math.min(WS_FRAME_MAX, LIMITS.bodyBytes));
    return { data: c.text, ...(c.truncated ? { truncated: true } : {}), length: utf8Length(data) };
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) return { binary: true, length: data.size };
  if (data instanceof ArrayBuffer) return { binary: true, length: data.byteLength };
  if (ArrayBuffer.isView(data)) return { binary: true, length: data.byteLength };
  return { binary: true };
}

export const installWebSocketHook: HookInstaller = (emit, win) => {
  const WS = win.WebSocket;
  if (typeof WS !== 'function') return () => {};
  const ids = new WeakMap<WebSocket, string>();
  let n = 0;
  const prefix = Math.random().toString(36).slice(2, 6);

  const Wrapped = wrapCtor(WS, (ws, args) => {
    const sid = `ws-${prefix}-${(n++).toString(36)}`;
    ids.set(ws, sid);
    const url = absoluteUrl(String(args[0]).replace(/^ws/, 'http')).replace(/^http/, 'ws');
    emit('ws', { sid, op: 'open', url });
    ws.addEventListener('open', () => quiet(() => emit('ws', { sid, op: 'open', url, ...(ws.protocol ? { protocol: ws.protocol } : {}), code: 101 })));
    ws.addEventListener('message', (e: MessageEvent) => quiet(() => emit('ws', { sid, op: 'recv', ...frameData(e.data) })));
    ws.addEventListener('close', (e: CloseEvent) => quiet(() => emit('ws', { sid, op: 'close', code: e.code, ...(e.reason ? { reason: e.reason } : {}) })));
    ws.addEventListener('error', () => quiet(() => emit('ws', { sid, op: 'error' })));
  });
  const send = WS.prototype.send;
  const wSend = wrapFn(send, (target, ws, args) => {
    // send() throws in CONNECTING state; record only frames the browser accepted.
    const r = Reflect.apply(target, ws, args) as void;
    quiet(() => {
      const sid = ids.get(ws as WebSocket);
      if (sid) emit('ws', { sid, op: 'send', ...frameData(args[0]) });
    });
    return r;
  });
  const r1 = replaceProp(win, 'WebSocket', Wrapped);
  const r2 = replaceProp(WS.prototype, 'send', wSend);
  return () => {
    r2();
    r1();
  };
};
