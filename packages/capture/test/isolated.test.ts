// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { UserEvent } from '@toolbar/shared';
import { MASKED_TYPING } from '@toolbar/shared/redact';
import { recordUserEvents } from '../src/user-events.ts';
import { describeNode } from '../src/target.ts';
import { parseUserAgent } from '../src/env.ts';

/** happy-dom events are untrusted; flip isTrusted so the recorder takes them. */
function trusted<E extends Event>(e: E): E {
  Object.defineProperty(e, 'isTrusted', { value: true });
  return e;
}

describe('target refs', () => {
  it('describes a button with test id, role, name and default submit type', () => {
    document.body.innerHTML = '<main><section><h2>Requests</h2><button data-testid="works" class="a svelte-x1">Save (works)</button></section></main>';
    const t = describeNode(document.querySelector('button'))!;
    expect(t).toMatchObject({ tag: 'button', role: 'button', testId: 'works', selector: 'button[data-testid="works"]', classes: ['a'], heading: 'Requests', landmarks: ['main'] });
    expect(t.attrs).toMatchObject({ type: 'submit', 'data-testid': 'works' });
  });

  it('masks the value attribute of password inputs', () => {
    document.body.innerHTML = '<label for="p">Password</label><input id="p" type="password" value="hunter2">';
    const t = describeNode(document.querySelector('input'))!;
    expect(t.attrs?.value).toBe(MASKED_TYPING);
    expect(JSON.stringify(t)).not.toContain('hunter2');
  });
});

describe('user events', () => {
  it('records clicks, one committed value per field with masking, chord keys and visibility', () => {
    document.body.innerHTML = `<form><input name="name" type="text"><input name="email" type="email"><input name="password" type="password"><textarea name="notes"></textarea><button data-testid="go">Go</button></form>`;
    const out: UserEvent[] = [];
    const rec = recordUserEvents({ emit: (e) => out.push(e) });
    const [name, email, pw] = Array.from(document.querySelectorAll('input'));
    const type = (el: HTMLInputElement, v: string) => {
      el.value = v;
      el.dispatchEvent(trusted(new Event('input', { bubbles: true })));
    };
    type(name!, 'Ada');
    type(name!, 'Ada L');
    name!.dispatchEvent(trusted(new Event('change', { bubbles: true })));
    type(email!, 'ada@example.com');
    email!.dispatchEvent(trusted(new Event('change', { bubbles: true })));
    type(pw!, 'hunter2');
    pw!.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    document.querySelector('button')!.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 6 })));
    document.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true })));
    // untrusted events (page scripts, our own UI) are ignored
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rec.stop();
    expect(out.map((e) => e.type)).toEqual(['input', 'input', 'input', 'key', 'click', 'key']);
    expect(out[0]).toMatchObject({ value: 'Ada L' });
    expect(out[0]!.masked).toBeUndefined();
    expect(out[1]).toMatchObject({ value: MASKED_TYPING, masked: true });
    expect(out[2]).toMatchObject({ value: MASKED_TYPING, masked: true });
    expect(out[3]).toMatchObject({ key: 'Enter' });
    expect(out[4]).toMatchObject({ x: 5, y: 6, target: { testId: 'go' } });
    expect(out[5]).toMatchObject({ key: 'S', mods: ['ctrl', 'shift'] });
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain('ada@example.com');
  });

  it('can be turned off (J-190)', () => {
    document.body.innerHTML = '<button>b</button>';
    const out: UserEvent[] = [];
    const rec = recordUserEvents({ emit: (e) => out.push(e) });
    rec.setEnabled(false);
    document.querySelector('button')!.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    rec.stop();
    expect(out).toEqual([]);
  });
});

describe('env', () => {
  it('parses browser and OS from the user agent', () => {
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.37 Safari/537.36')).toEqual({ browser: { name: 'Chrome', version: '141.0.7390.37' }, os: { name: 'Linux' } });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57').browser).toEqual({ name: 'Edge', version: '141.0.3537.57' });
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1').os).toEqual({ name: 'iOS', version: '17.4' });
  });
});
