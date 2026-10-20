// @vitest-environment happy-dom
// <OpenToolbar /> (D-211, D-213): the first render starts the toolbar with the user; a later
// user (sign-in, sign-out) renames the reviewer through setUser and never starts it again.
// React is an optional peer the package does not install, so a small stand-in runs the hooks:
// one ref per component and effects that run when their dependencies change.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  const state = { refs: [] as { current: unknown }[], deps: [] as (unknown[] | undefined)[], i: 0, e: 0 };
  return {
    state,
    render<P>(fn: (p: P) => unknown, props: P) {
      state.i = 0;
      state.e = 0;
      fn(props);
    },
    useRef<T>(v: T) {
      const i = state.i++;
      state.refs[i] ??= { current: v };
      return state.refs[i] as { current: T };
    },
    useEffect(fn: () => void, deps: unknown[]) {
      const i = state.e++;
      const prev = state.deps[i];
      if (!prev || prev.length !== deps.length || prev.some((d, k) => !Object.is(d, deps[k]))) {
        state.deps[i] = deps;
        fn();
      }
    },
  };
});
vi.mock('react', () => ({ useRef: hooks.useRef, useEffect: hooks.useEffect }));
const calls = vi.hoisted(() => ({ init: [] as unknown[], setUser: [] as unknown[] }));
vi.mock('../src/init.ts', () => ({ init: (o: unknown) => calls.init.push(o), setUser: (u: unknown) => calls.setUser.push(u) }));

const { OpenToolbar } = await import('../src/react');

describe('OpenToolbar', () => {
  beforeEach(() => {
    hooks.state.refs = [];
    hooks.state.deps = [];
    calls.init = [];
    calls.setUser = [];
  });

  it('starts the toolbar once and renames the reviewer when the user changes', () => {
    const props = { siteKey: 'tbk_a', server: 'https://tb.example' };
    hooks.render(OpenToolbar, { ...props, user: { name: 'Ada' } });
    hooks.render(OpenToolbar, { ...props, user: { name: 'Ada' } });
    expect(calls.init).toEqual([{ key: 'tbk_a', server: 'https://tb.example', user: { name: 'Ada', email: undefined } }]);
    expect(calls.setUser).toEqual([]);
    hooks.render(OpenToolbar, { ...props, user: { name: 'Grace', email: 'g@example.com' } });
    hooks.render(OpenToolbar, props);
    expect(calls.init).toHaveLength(1);
    expect(calls.setUser).toEqual([{ name: 'Grace', email: 'g@example.com' }, { name: undefined, email: undefined }]);
  });
});
