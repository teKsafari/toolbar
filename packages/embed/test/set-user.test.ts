// @vitest-environment happy-dom
// setUser (D-213): the app names the reviewer again after init, from the package export or from
// window.openToolbar; a user named before init is the one init starts with.
import { describe, expect, it, vi } from 'vitest';

const made = vi.hoisted(() => [] as { site: unknown; setSite: ReturnType<typeof vi.fn> }[]);
vi.mock('../src/reviewer.ts', async (orig) => {
  const real = await orig<typeof import('../src/reviewer')>();
  return {
    ...real,
    ReviewerStore: class extends real.ReviewerStore {
      constructor(site: { name?: string; email?: string } = {}) {
        super(site);
        const setSite = vi.fn((u: { name?: string; email?: string }) => super.setSite(u));
        this.setSite = setSite;
        made.push({ site, setSite });
      }
    },
  };
});

describe('setUser', () => {
  it('reaches the reviewer before and after init', async () => {
    // the config never answers: init has started, the toolbar is not up yet
    vi.spyOn(window, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    const { init, setUser } = await import('../src/index');
    setUser({ name: 'Early' });
    init({ key: 'tbk_a', server: 'https://tb.example' });
    expect(made).toHaveLength(1);
    expect(made[0]!.site).toEqual({ name: 'Early', email: undefined });
    setUser({ name: 'Ada', email: 'ada@example.com' });
    window.openToolbar!.setUser({ name: 'Grace' });
    expect(made[0]!.setSite.mock.calls).toEqual([[{ name: 'Ada', email: 'ada@example.com' }], [{ name: 'Grace', email: undefined }]]);
    expect(made).toHaveLength(1);
  });
});

describe('reviewer store', () => {
  it('takes the site user setUser gives, after a name the reviewer typed', async () => {
    localStorage.clear();
    const { ReviewerStore } = await vi.importActual<typeof import('../src/reviewer')>('../src/reviewer');
    const r = new ReviewerStore({ name: 'Ada', email: 'ada@example.com' });
    r.setSite({ name: 'Grace' });
    expect(r.get()).toEqual({ id: r.get().id, name: 'Grace' });
    expect(await r.load()).toEqual({ name: 'Grace', ask: false });
    r.setSite({});
    expect(r.get()).toEqual({ id: r.get().id });
    expect(await r.load()).toEqual({ name: '', ask: true });
    await r.save('Typed');
    r.setSite({ name: 'Hopper' });
    expect(r.get().name).toBe('Typed');
  });
});
