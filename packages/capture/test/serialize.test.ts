import { describe, expect, it } from 'vitest';
import { serialize, formatArgs } from '../src/serialize.ts';
import { fmtArgs } from '@toolbar/shared/derive';

describe('serialize', () => {
  it('keeps plain JSON values', () => {
    expect(serialize({ a: 1, b: 'x', c: [true, null] })).toEqual({ a: 1, b: 'x', c: [true, null] });
  });

  it('tags values JSON cannot hold', () => {
    expect(serialize(undefined)).toEqual({ $t: 'undefined' });
    expect(serialize(10n)).toEqual({ $t: 'bigint', value: '10' });
    expect(serialize(Symbol('s'))).toEqual({ $t: 'symbol', desc: 's' });
    expect(serialize(function named() {})).toEqual({ $t: 'fn', name: 'named' });
    expect(serialize(NaN)).toEqual({ $t: 'number', value: 'NaN' });
    expect(serialize(new Date('2026-01-02T03:04:05Z'))).toEqual({ $t: 'date', value: '2026-01-02T03:04:05.000Z' });
    expect(serialize(/a+/g)).toEqual({ $t: 'regexp', value: '/a+/g' });
    expect(serialize(new Uint8Array(4))).toEqual({ $t: 'typed', type: 'Uint8Array', length: 4 });
  });

  it('keeps name, message and stack of errors', () => {
    const e = new TypeError('bad');
    const s = serialize(e) as Record<string, unknown>;
    expect(s).toMatchObject({ $t: 'error', name: 'TypeError', message: 'bad' });
    expect(String(s.stack)).toContain('TypeError: bad');
  });

  it('marks cycles and caps depth, keys and strings', () => {
    const o: Record<string, unknown> = { name: 'root' };
    o.self = o;
    expect(serialize(o)).toEqual({ name: 'root', self: { $t: 'cycle' } });
    expect(serialize({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: { $t: 'more', kind: 'object', name: 'Object' } } } } });
    const many = Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`k${i}`, i]));
    const s = serialize(many) as Record<string, unknown>;
    expect(Object.keys(s)).toHaveLength(101);
    expect(serialize('x'.repeat(20_000))).toMatchObject({ $t: 'trunc', bytes: 20_000 });
  });

  it('summarizes maps and sets and survives throwing getters', () => {
    expect(serialize(new Map([['a', 1]]))).toEqual({ $t: 'map', size: 1, entries: [['a', 1]] });
    expect(serialize(new Set([1, 2]))).toEqual({ $t: 'set', size: 2, entries: [1, 2] });
    const o = Object.defineProperty({}, 'boom', { enumerable: true, get: () => { throw new Error('nope'); } });
    expect(serialize(o)).toEqual({ boom: { $t: 'throws', message: 'nope' } });
  });

  it('formats one-line text for rows', () => {
    expect(formatArgs(['a', 1, { b: 2 }, serialize(new Error('x'))])).toBe('a 1 {"b":2} Error: x');
  });
});

describe('serialized values through the viewer formatter (J-055, J-056)', () => {
  it('prints every tag readably: no wire form reaches the console row', () => {
    const at = new Date('2026-10-15T03:38:35.057Z');
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const many = Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`k${i}`, i]));
    const thrower = Object.defineProperty({}, 'bad', { enumerable: true, get: () => { throw new Error('boom'); } });
    const args = [
      { user: { id: 7 }, at },
      [at, /a+/g, NaN, 12n, undefined, Symbol('s'), () => 1],
      new Map([['k', at]]),
      new Set([1, 2]),
      new Uint8Array(3),
      Promise.resolve(1),
      deep,
      many,
      thrower,
      { $t: 'user data' },
      new Error('lab error object'),
    ].map((a) => serialize(a));
    const text = fmtArgs(args);
    expect(text).not.toMatch(/"?\$t"?\s*:\s*"(date|regexp|number|map|set|typed|promise|more|throws|bigint|symbol|fn|undefined)"/);
    expect(text).toContain('{user: {id: 7}, at: 2026-10-15T03:38:35.057Z}');
    expect(text).toContain('[2026-10-15T03:38:35.057Z, /a+/g, NaN, 12n, undefined, Symbol(s), f anonymous()]');
    expect(text).toContain('Map(1) {"k" => 2026-10-15T03:38:35.057Z}');
    expect(text).toContain('Set(2) {1, 2}');
    expect(text).toContain('Uint8Array(3)');
    expect(text).toContain('Promise');
    expect(text).toContain('...5 more}');
    expect(text).toContain('{bad: [Exception: boom]}');
    expect(text).toContain('{$t: "user data"}');
    expect(text).toContain('Error: lab error object');
  });
});
