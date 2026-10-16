// Messages between the page and its dedicated Web Workers, as timing only (D-189). A code
// runner such as Nuru's interpreter posts the program to a worker and hears nothing until the
// output: `send` marks the post, `recv` the worker's first message after it, so the span
// engine can keep the run's span open until the answer. No payload is recorded, and a worker
// that is already owed an answer emits no second `send`.
import type { HookInstaller } from '../transport.ts';
import { quiet, replaceProp, wrapFn } from './util.ts';

export const installWorkerHook: HookInstaller = (emit, win) => {
  const W = win.Worker;
  if (typeof W !== 'function' || !W.prototype?.postMessage) return () => {};
  const state = new WeakMap<Worker, { wid: string; waiting: boolean }>();
  const addListener = W.prototype.addEventListener;
  let n = 0;
  const prefix = Math.random().toString(36).slice(2, 6);

  const post = W.prototype.postMessage;
  const wPost = wrapFn(post, (target, worker, args) => {
    const r = Reflect.apply(target, worker, args) as void;
    quiet(() => {
      const w = worker as Worker;
      let st = state.get(w);
      if (!st) {
        const s = { wid: `w-${prefix}-${(n++).toString(36)}`, waiting: false };
        st = s;
        state.set(w, s);
        addListener.call(w, 'message', () =>
          quiet(() => {
            if (!s.waiting) return;
            s.waiting = false;
            emit('worker', { wid: s.wid, op: 'recv' });
          }),
        );
      }
      if (st.waiting) return;
      st.waiting = true;
      emit('worker', { wid: st.wid, op: 'send' });
    });
    return r;
  });
  const undo = replaceProp(W.prototype, 'postMessage', wPost);
  return () => undo();
};
