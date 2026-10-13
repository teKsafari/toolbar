// ISOLATED world, document_start: bridge from the main world, plus the shadow-root UI.
(() => {
  const bg = chrome.runtime.connect({ name: 'capture' });
  bg.postMessage({ kind: 'isolated-boot', t: performance.now(), readyState: document.readyState, frame: location.href });

  window.addEventListener(
    'message',
    (e) => {
      if (e.source !== window || e.data?.__tb !== 'hello' || !e.ports[0]) return;
      e.stopImmediatePropagation(); // the page never sees the handshake
      const p = e.ports[0];
      p.onmessage = (m) => bg.postMessage({ via: 'port', ...m.data });
      p.postMessage('ack');
    },
    true,
  );
  window.postMessage({ __tb: 'ready' }, '*');

  // ---- UI in a shadow root (closed in release builds) ----
  const mode = globalThis.TB_FLAGS?.shadowMode ?? 'closed';
  const roots = {};
  function mount(tag, reset) {
    const host = document.createElement(tag);
    const root = host.attachShadow({ mode });
    root.innerHTML = `
      <style>
        ${reset ? ':host { all: initial !important; display: block !important; position: fixed !important; bottom: 16px !important; right: 16px !important; z-index: 2147483647 !important; }' : ':host { display: block; position: fixed; }'}
        .bar { font: 13px/1.4 system-ui, sans-serif; padding: 6px; background: #222; border-radius: 6px; }
        button { all: unset; background: #e4572e; color: #fff; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
      </style>
      <div class="bar"><button id="tb-btn">Report</button> <span class="txt">plain text</span></div>`;
    if (!reset) host.style.cssText = 'bottom:16px;right:180px';
    root.getElementById('tb-btn').addEventListener('click', (e) =>
      chrome.runtime.sendMessage({ to: 'bg-log', args: ['ui click', tag, { isTrusted: e.isTrusted }] }),
    );
    document.documentElement.appendChild(host);
    roots[tag] = { host, root };
  }
  const start = () => {
    mount('toolbar-root', true);
    mount('toolbar-noreset', false);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== 'probe-ui') return;
    const out = { mode };
    for (const [tag, { host, root }] of Object.entries(roots)) {
      const btn = getComputedStyle(root.getElementById('tb-btn'));
      const txt = getComputedStyle(root.querySelector('.txt'));
      const hs = getComputedStyle(host);
      out[tag] = {
        hostDisplay: hs.display,
        pageSeesShadowRoot: host.shadowRoot !== null,
        button: { bg: btn.backgroundColor, color: btn.color, fontSize: btn.fontSize },
        text: { color: txt.color, fontFamily: txt.fontFamily, letterSpacing: txt.letterSpacing },
        rect: root.getElementById('tb-btn').getBoundingClientRect().toJSON(),
      };
    }
    reply(out);
  });
})();
