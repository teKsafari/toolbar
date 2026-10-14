import { describe, expect, it, vi, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { Button, Icon, Toaster, toasts } from '../src/index.ts';

afterEach(() => {
  document.body.innerHTML = '';
  toasts.clear();
});

describe('Icon', () => {
  it('is decorative without a label and an img with one', () => {
    const a = mount(Icon, { target: document.body, props: { name: 'pen' } });
    const b = mount(Icon, { target: document.body, props: { name: 'stop', label: 'Stop' } });
    const [s1, s2] = document.querySelectorAll('svg');
    expect(s1!.getAttribute('aria-hidden')).toBe('true');
    expect(s2!.getAttribute('role')).toBe('img');
    expect(s2!.getAttribute('aria-label')).toBe('Stop');
    unmount(a);
    unmount(b);
  });
});

describe('Button', () => {
  it('fires onclick and disables while loading', () => {
    const onclick = vi.fn();
    const props = $state({ variant: 'primary' as const, icon: 'check' as const, onclick, loading: false, 'aria-label': 'Save' });
    const c = mount(Button, { target: document.body, props });
    const btn = document.querySelector('button')!;
    btn.click();
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(btn.className).toContain('nb-primary');
    props.loading = true;
    flushSync();
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('[data-icon="spinner"]')).not.toBeNull();
    unmount(c);
  });
});

describe('Toaster', () => {
  it('shows, updates in place and dismisses toasts', () => {
    vi.useFakeTimers();
    const c = mount(Toaster, { target: document.body });
    const id = toasts.loading('Creating link');
    flushSync();
    expect(document.querySelector('[data-kind="loading"]')?.textContent).toContain('Creating link');
    toasts.update(id, { kind: 'success', message: 'Link copied' });
    flushSync();
    expect(document.querySelector('[data-kind="success"]')?.textContent).toContain('Link copied');
    vi.advanceTimersByTime(4100);
    flushSync();
    expect(document.querySelectorAll('.nb-toast').length).toBe(0);
    unmount(c);
    vi.useRealTimers();
  });
});
