// MAIN world, document_start. Wraps console and fetch, buffers events, and hands them to
// the isolated world over a private MessageChannel.
(() => {
  const boot = {
    kind: 'boot',
    t: performance.now(),
    readyState: document.readyState,
    scriptsInDom: document.scripts.length,
    htmlChildren: document.documentElement ? document.documentElement.childElementCount : -1,
    // Fetched by the preload scanner is not the same as executed; these globals prove no page script ran yet.
    resourcesFetched: performance.getEntriesByType('resource').length,
    sveltekitGlobals: Object.keys(window).filter((k) => k.startsWith('__sveltekit')),
    url: location.href,
  };
  const buffer = [boot];
  let port = null;
  const emit = (ev) => {
    ev.t ??= performance.now();
    if (port) port.postMessage(ev);
    else buffer.push(ev);
  };

  const ser = (v, depth = 0) => {
    if (v instanceof Error) return { $error: v.name, message: v.message, stack: v.stack };
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? `[fn ${v.name}]` : v;
    if (v instanceof Date) return { $date: v.toISOString() };
    if (depth > 4) return '[depth]';
    if (Array.isArray(v)) return v.map((x) => ser(x, depth + 1));
    const o = {};
    for (const k of Object.keys(v)) o[k] = ser(v[k], depth + 1);
    return o;
  };

  // ---- console ----
  const levels = ['log', 'info', 'warn', 'error', 'debug', 'table', 'group', 'groupCollapsed', 'groupEnd', 'trace', 'assert', 'count', 'time', 'timeEnd', 'dir'];
  for (const level of levels) {
    const orig = console[level];
    if (typeof orig !== 'function') continue;
    const wrapped = {
      [level](...args) {
        try {
          if (!(level === 'assert' && args[0])) {
            const ev = { kind: 'console', level, args: args.map((a) => ser(a)) };
            if (level === 'trace' || level === 'error') ev.stack = new Error().stack.split('\n').slice(2).join('\n');
            emit(ev);
          }
        } catch {}
        return orig.apply(this, args);
      },
    }[level];
    Object.defineProperty(wrapped, 'toString', { value: () => orig.toString() });
    console[level] = wrapped;
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  let seq = 0;
  const fetchWrapped = function fetch(input, init) {
    const id = ++seq;
    const req = new Request(input, init);
    const t0 = performance.now();
    emit({ kind: 'net.request', id, method: req.method, url: req.url });
    const p = origFetch.apply(this, arguments);
    p.then(
      (res) => {
        emit({ kind: 'net.response', id, status: res.status, ok: res.ok, ms: Math.round(performance.now() - t0) });
        res.clone().text().then(
          (body) => emit({ kind: 'net.body', id, body: body.slice(0, 2000) }),
          () => {},
        );
      },
      (err) => emit({ kind: 'net.error', id, message: String(err) }),
    );
    return p;
  };
  Object.defineProperty(fetchWrapped, 'toString', { value: () => origFetch.toString() });
  window.fetch = fetchWrapped;

  addEventListener('error', (e) => emit({ kind: 'error', message: e.message, stack: e.error?.stack }));
  addEventListener('unhandledrejection', (e) => emit({ kind: 'unhandledrejection', reason: ser(e.reason) }));

  // ---- bridge: hello with a fresh port; answer the isolated world's "ready" with another ----
  const offerPort = () => {
    const ch = new MessageChannel();
    window.postMessage({ __tb: 'hello' }, '*', [ch.port2]);
    ch.port1.onmessage = (e) => {
      if (e.data === 'ack' && !port) {
        port = ch.port1;
        for (const ev of buffer.splice(0)) port.postMessage(ev);
      }
    };
  };
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.__tb === 'ready' && !port) offerPort();
  });
  offerPort();
})();
