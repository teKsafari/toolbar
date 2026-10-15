import { describe, expect, it } from 'vitest';
import { ROUTES, spansQuerySchema } from '../src/api/index.ts';

describe('spans route (Part 2 traces)', () => {
  it('is in the route table and parses its query', () => {
    expect(ROUTES['captures.spans'].path).toBe('/api/v1/recordings/:id/spans');
    expect(spansQuerySchema.parse({ outcome: 'dead,stuck' })).toEqual({ format: 'json', outcome: ['dead', 'stuck'] });
    expect(spansQuerySchema.parse({ format: 'jsonl' })).toEqual({ format: 'jsonl' });
    expect(spansQuerySchema.safeParse({ outcome: 'nope' }).success).toBe(false);
  });
});
