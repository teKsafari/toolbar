// MAIN <-> ISOLATED bridge (docs/spikes.md section 3).
// Script order between worlds is not guaranteed, so both sides can start the handshake:
// MAIN offers a port at boot and again whenever ISOLATED posts "ready".
import { BRIDGE_TAG } from '@toolbar/shared';

type Msg = { [BRIDGE_TAG]: 'hello' | 'ready' };

/** MAIN world side. Buffers until the isolated world acknowledges a port. */
export function createMainBridge(win: Window = window) {
  let port: MessagePort | null = null;
  const buffer: unknown[] = [];

  const offer = () => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      if (e.data === 'ack' && !port) {
        port = ch.port1;
        for (const m of buffer.splice(0)) port.postMessage(m);
      }
    };
    win.postMessage({ [BRIDGE_TAG]: 'hello' } satisfies Msg, '*', [ch.port2]);
  };

  win.addEventListener('message', (e) => {
    if (e.source === win && (e.data as Msg | null)?.[BRIDGE_TAG] === 'ready' && !port) offer();
  });
  offer();

  return {
    post(msg: unknown) {
      if (port) port.postMessage(msg);
      else buffer.push(msg);
    },
    get connected() {
      return port !== null;
    },
  };
}

/** ISOLATED world side. Takes the port in the capture phase and hides the message from the page. */
export function acceptMainBridge(onMessage: (data: unknown) => void, win: Window = window) {
  let connected = false;
  win.addEventListener(
    'message',
    (e) => {
      if (e.source !== win || (e.data as Msg | null)?.[BRIDGE_TAG] !== 'hello' || !e.ports[0]) return;
      e.stopImmediatePropagation();
      if (connected) return;
      connected = true;
      const p = e.ports[0];
      p.onmessage = (m) => onMessage(m.data);
      p.postMessage('ack');
    },
    true,
  );
  win.postMessage({ [BRIDGE_TAG]: 'ready' } satisfies Msg, '*');
  return { get connected() { return connected; } };
}
