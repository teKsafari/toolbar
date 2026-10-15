// Storage keys moved from the old "nib:" prefix to "tb:" (D-111).
import { describe, expect, it } from 'vitest';
import { migrateLegacyKeys, type MigratableArea } from '@toolbar/shared/ext';

function area(init: Record<string, unknown>) {
  const data = { ...init };
  const a: MigratableArea & { data: Record<string, unknown> } = {
    data,
    get: async () => ({ ...data }),
    set: async (items) => void Object.assign(data, items),
    remove: async (keys) => keys.forEach((k) => delete data[k]),
  };
  return a;
}

describe('storage key migration', () => {
  it('moves nib:* to tb:* once and removes the old keys', async () => {
    const a = area({ 'nib:auth': { token: 't' }, 'nib:settings': { mic: true }, 'nib:cap:last-end': { 1: 5 }, other: 1 });
    expect((await migrateLegacyKeys(a)).sort()).toEqual(['tb:auth', 'tb:cap:last-end', 'tb:settings']);
    expect(a.data).toEqual({ 'tb:auth': { token: 't' }, 'tb:settings': { mic: true }, 'tb:cap:last-end': { 1: 5 }, other: 1 });
    expect(await migrateLegacyKeys(a)).toEqual([]);
  });

  it('keeps a tb:* value that already exists', async () => {
    const a = area({ 'nib:auth': { token: 'old' }, 'tb:auth': { token: 'new' } });
    await migrateLegacyKeys(a);
    expect(a.data).toEqual({ 'tb:auth': { token: 'new' } });
  });
});
