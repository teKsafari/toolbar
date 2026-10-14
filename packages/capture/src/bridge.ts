// MAIN <-> ISOLATED bridge (docs/spikes.md section 3).
// Script order between worlds is not guaranteed, so both sides can start the handshake:
// MAIN offers a port at boot and again whenever ISOLATED posts "ready". After the handshake
// both directions use the private MessagePort: MAIN sends events, ISOLATED sends commands
// (MainCommand) and MAIN answers them (MainReply).
import { BRIDGE_TAG } from '@toolbar/shared/constants';

type Msg = { [BRIDGE_TAG]: 'hello' | 'ready' };

/** ISOLATED -> MAIN. */
export type MainCommand = { cmd: 'metadata'; id: number };
/** MAIN -> ISOLATED answers, told apart from events by `reply`. */
export type MainReply = { reply: 'metadata'; id: number; value?: Record<string, unknown> | null; error?: string };

export function isMainReply(x: unknown): x is MainReply {
  return typeof x === 'object' && x !== null && typeof (x as MainReply).reply === 'string';
}

/** MAIN world side. Buffers until the isolated world acknowledges a port. */
export function createMainBridge(win: Window = window) {
  let port: MessagePort | null = null;
  const buffer: unknown[] = [];
  const handlers: ((c: MainCommand) => void)[] = [];

  const offer = () => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      if (e.data === 'ack') {
        if (!port) {
          port = ch.port1;
          for (const m of buffer.splice(0)) port.postMessage(m);
        }
        return;
      }
      if (port === ch.port1 && e.data && typeof e.data === 'object' && 'cmd' in e.data) for (const h of handlers) h(e.data as MainCommand);
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
      else {
        buffer.push(msg);
        if (buffer.length > 5000) buffer.splice(0, buffer.length - 5000);
      }
    },
    onCommand(fn: (c: MainCommand) => void) {
      handlers.push(fn);
    },
    get connected() {
      return port !== null;
    },
  };
}

/** ISOLATED world side. Takes the port in the capture phase and hides the message from the page. */
export function acceptMainBridge(onMessage: (data: unknown) => void, win: Window = window) {
  let port: MessagePort | null = null;
  win.addEventListener(
    'message',
    (e) => {
      if (e.source !== win || (e.data as Msg | null)?.[BRIDGE_TAG] !== 'hello' || !e.ports[0]) return;
      e.stopImmediatePropagation();
      if (port) return;
      const p = e.ports[0];
      port = p;
      p.onmessage = (m) => onMessage(m.data);
      p.postMessage('ack');
    },
    true,
  );
  win.postMessage({ [BRIDGE_TAG]: 'ready' } satisfies Msg, '*');
  return {
    get connected() {
      return port !== null;
    },
    /** Send a command to the MAIN world; false when the bridge is not up yet. */
    command(c: MainCommand): boolean {
      if (!port) return false;
      port.postMessage(c);
      return true;
    },
  };
}
