// The package's hand-written types (types/*.d.ts, copied to dist/) match the source. The checks
// run in the type check (pnpm check); at run time this only confirms the exports exist.
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as src from '../src/index';
import * as srcReact from '../src/react';
import type * as pub from '../types/index';
import type * as pubReact from '../types/react';

describe('published types', () => {
  it('match the source', () => {
    expectTypeOf<pub.InitOptions>().toEqualTypeOf<src.InitOptions>();
    expectTypeOf<pub.OpenToolbarApi>().toEqualTypeOf<src.OpenToolbarApi>();
    expectTypeOf<typeof pub.init>().toEqualTypeOf<typeof src.init>();
    expectTypeOf<pubReact.OpenToolbarProps>().toEqualTypeOf<srcReact.OpenToolbarProps>();
    expectTypeOf<typeof pubReact.OpenToolbar>().toEqualTypeOf<typeof srcReact.OpenToolbar>();
    expect(typeof src.init).toBe('function');
    expect(typeof srcReact.OpenToolbar).toBe('function');
  });
});
