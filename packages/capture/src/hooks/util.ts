// Shared helpers for the MAIN-world hooks. Rules: page code must not be able to tell a wrapped
// API from the native one by toString, name, length or instanceof, and a failure in our code
// must never reach the page.

/** Wraps a function with a Proxy so name, length, toString and prototype stay native. */
export function wrapFn<F extends (...args: never[]) => unknown>(
  fn: F,
  apply: (target: F, thisArg: unknown, args: Parameters<F>) => ReturnType<F>,
): F {
  return new Proxy(fn, {
    apply(target, thisArg, args) {
      return apply(target, thisArg, args as Parameters<F>);
    },
  });
}

/** Wraps a constructor with a Proxy; `after` sees each new instance. Statics and prototype stay. */
export function wrapCtor<C extends abstract new (...args: never[]) => object>(ctor: C, after: (instance: InstanceType<C>, args: unknown[]) => void): C {
  const proxy: C = new Proxy(ctor, {
    construct(target, args, newTarget) {
      const inst = Reflect.construct(target, args, newTarget === proxy ? target : newTarget) as InstanceType<C>;
      quiet(() => after(inst, args));
      return inst;
    },
  });
  return proxy;
}

/** Replaces obj[key] (data property) and returns a restore function. */
export function replaceProp<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): () => void {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  try {
    Object.defineProperty(obj, key, { ...(desc ?? { enumerable: true, configurable: true }), value, writable: desc?.writable ?? true });
  } catch {
    (obj as Record<K, T[K]>)[key] = value;
  }
  return () => {
    try {
      if (desc) Object.defineProperty(obj, key, desc);
      else delete (obj as Record<K, unknown>)[key];
    } catch {
      /* page made it read-only */
    }
  };
}

/** Runs our code; swallows anything it throws so the page never sees our bugs. */
export function quiet(fn: () => void): void {
  try {
    fn();
  } catch {
    /* never surface capture failures in page code */
  }
}

/** True while our own code runs, so wrapped APIs we call do not record themselves. */
let busy = 0;
export function guarded<T>(fn: () => T): T {
  busy++;
  try {
    return fn();
  } finally {
    busy--;
  }
}
export const isBusy = () => busy > 0;

/** High-resolution epoch ms, the envelope clock (architecture s4). */
export const now = () => performance.timeOrigin + performance.now();

let ownFile: string | null = null;
/** URL of this capture script, learned from a stack at install time, to strip our frames. */
export function learnOwnFile(): void {
  const stack = new Error().stack ?? '';
  const m = /\((\S+?):\d+:\d+\)|at (\S+?):\d+:\d+/.exec(stack.split('\n').slice(1).join('\n'));
  ownFile = m ? (m[1] ?? m[2] ?? null) : null;
}

/** Stack of the page call site: the Error header and our own frames are removed. */
export function callSiteStack(skip = 0): string | undefined {
  const raw = new Error().stack;
  if (!raw) return undefined;
  const lines = raw.split('\n').slice(1);
  const page = lines.filter((l) => !(ownFile && l.includes(ownFile)) && !l.includes('chrome-extension://'));
  const out = page.slice(skip).map((l) => l.trim());
  return out.length ? out.join('\n') : undefined;
}

/** Text-like content types whose bodies are kept (architecture s4 "Bodies"). */
export function isTextLike(ct: string | null | undefined): boolean {
  if (!ct) return true;
  const c = ct.toLowerCase();
  return (
    c.startsWith('text/') ||
    c.includes('json') ||
    c.includes('xml') ||
    c.includes('javascript') ||
    c.includes('x-www-form-urlencoded') ||
    c.includes('graphql') ||
    c.includes('csv') ||
    c.includes('yaml')
  ) && !c.includes('event-stream');
}

export function absoluteUrl(u: string | URL, base = location.href): string {
  try {
    return new URL(String(u), base).href;
  } catch {
    return String(u);
  }
}

export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Cuts a string to `max` UTF-16 units; flags the cut. */
export function cap(s: string, max: number): { text: string; truncated: boolean } {
  return s.length > max ? { text: s.slice(0, max), truncated: true } : { text: s, truncated: false };
}
