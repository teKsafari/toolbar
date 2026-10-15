// A minimal WebSocket server endpoint (RFC 6455) for the CDP proxy in `open-toolbar record`: handshake,
// text and binary frames, ping, close. Node has a WebSocket client built in but no server.
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsPeer {
  send(text: string): void;
  close(): void;
  onMessage(fn: (text: string) => void): void;
  onClose(fn: () => void): void;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

export function acceptUpgrade(req: IncomingMessage, socket: Duplex): WsPeer {
  const key = String(req.headers['sec-websocket-key'] ?? '');
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  const onMsg: ((t: string) => void)[] = [];
  const onCls: (() => void)[] = [];
  let buf = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      socket.write(frame(0x8, Buffer.alloc(0)));
    } catch {
      /* gone */
    }
    socket.end();
    onCls.forEach((f) => f());
  };
  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0]! & 0x80) !== 0;
      const op = buf[0]! & 0x0f;
      const masked = (buf[1]! & 0x80) !== 0;
      let len = buf[1]! & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i]! ^= buf[maskOff + (i % 4)]!;
      buf = buf.subarray(off + len);
      if (op === 0x8) return close();
      if (op === 0x9) {
        socket.write(frame(0xa, payload));
        continue;
      }
      if (op === 0xa) continue;
      parts.push(payload);
      if (fin) {
        const text = Buffer.concat(parts).toString('utf8');
        parts = [];
        onMsg.forEach((f) => f(text));
      }
    }
  });
  socket.on('close', close);
  socket.on('error', close);
  return {
    send: (t) => !closed && socket.write(frame(0x1, Buffer.from(t, 'utf8'))),
    close,
    onMessage: (f) => onMsg.push(f),
    onClose: (f) => onCls.push(f),
  };
}
