// console.* at every level (J-055, J-056). Args go through serialize(); each row carries the
// call-site stack. count, time and assert keep the native semantics and record what they print.
import type { ConsoleLevel, Serialized } from '@toolbar/shared';
import type { HookInstaller } from '../transport.ts';
import { serialize } from '../serialize.ts';
import { describeNode } from '../target.ts';
import { callSiteStack, guarded, isBusy, quiet, replaceProp, wrapFn } from './util.ts';

export const HOOKED_LEVELS: ConsoleLevel[] = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'table',
  'dir',
  'group',
  'groupCollapsed',
  'groupEnd',
  'assert',
  'count',
  'time',
  'timeEnd',
  'clear',
];

export const installConsoleHook: HookInstaller = (emit, win) => {
  const c = win.console as unknown as Record<string, (...a: unknown[]) => unknown>;
  if (!c) return () => {};
  const counts = new Map<string, number>();
  const timers = new Map<string, number>();
  const restore: (() => void)[] = [];
  const ser = (a: unknown): Serialized => serialize(a, { describeNode: (n) => describeNode(n as Node) });

  for (const level of HOOKED_LEVELS) {
    const orig = c[level];
    if (typeof orig !== 'function') continue;
    const wrapped = wrapFn(orig, (target, thisArg, args) => {
      if (!isBusy())
        quiet(() =>
          guarded(() => {
            let out: unknown[] = args;
            let count: number | undefined;
            switch (level) {
              case 'assert':
                if (args[0]) return;
                out = args.length > 1 ? args.slice(1) : ['Assertion failed'];
                break;
              case 'count': {
                const label = args[0] === undefined ? 'default' : String(args[0]);
                count = (counts.get(label) ?? 0) + 1;
                counts.set(label, count);
                out = [`${label}: ${count}`];
                break;
              }
              case 'time': {
                const label = args[0] === undefined ? 'default' : String(args[0]);
                timers.set(label, performance.now());
                out = [label];
                break;
              }
              case 'timeEnd': {
                const label = args[0] === undefined ? 'default' : String(args[0]);
                const t0 = timers.get(label);
                timers.delete(label);
                out = [t0 === undefined ? `Timer '${label}' does not exist` : `${label}: ${(performance.now() - t0).toFixed(3)} ms`];
                break;
              }
            }
            emit('console', { level, args: out.map(ser), stack: callSiteStack(), ...(count !== undefined ? { count } : {}) });
          }),
        );
      // The native call runs guarded too: some consoles implement count or assert through log.
      return guarded(() => Reflect.apply(target, thisArg, args));
    });
    restore.push(replaceProp(c, level, wrapped));
  }
  return () => {
    for (const r of restore.reverse()) r();
  };
};
