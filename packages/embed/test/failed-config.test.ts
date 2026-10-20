// @vitest-environment happy-dom
// A key that does not work (D-213): with a trace an earlier page of the tab left running and rows
// it could not send, a 403 on the config still sends nothing after it. The session never boots,
// so no chunk goes up on a timer, at pagehide or back from the back-forward cache, and the stored
// trace stays for a page where the key works.
import { describe, expect, it, vi } from 'vitest';

describe('failed config', () => {
  it('sends nothing after the config is refused', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const trace = { id: 'rec-1', uploadToken: 'tb_upl_x', startedAt: 1, url: 'https://app.example/', title: '', seq: { events: 2, rrweb: 1 }, bytes: { events: 10, rrweb: 10 } };
    sessionStorage.setItem('tb:page-trace', JSON.stringify(trace));
    sessionStorage.setItem('tb:page-trace-pending', JSON.stringify({ id: 'rec-1', events: [{ t: 5, kind: 'console' }], rrweb: [] }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: 'origin_not_allowed' }), { status: 403, headers: { 'content-type': 'application/json' } }));
    const { init } = await import('../src/init');
    init({ key: 'tbk_x', server: 'https://tb.example' });
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('[open-toolbar] not started: this origin is not one of the project'));
    dispatchEvent(new Event('pagehide'));
    const show = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(show, 'persisted', { value: true });
    dispatchEvent(show);
    vi.advanceTimersByTime(20_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual(['https://tb.example/api/v1/embed/tbk_x/config']);
    expect(JSON.parse(sessionStorage.getItem('tb:page-trace')!)).toEqual(trace);
    expect(sessionStorage.getItem('tb:page-trace-pending')).not.toBeNull();
    expect(document.querySelector('toolbar-root')).toBeNull();
    vi.useRealTimers();
  });
});
