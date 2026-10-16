// Minimal raw CDP client over the browser websocket, flat sessions.
export async function cdpConnect(port = 9462) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waits = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waits.has(d.id)) { const w = waits.get(d.id); waits.delete(d.id); d.error ? w.j(new Error(d.error.message)) : w.r(d.result); }
    else for (const l of listeners) l(d);
  };
  const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; waits.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  return { send, on: (f) => listeners.push(f), close: () => ws.close() };
}
