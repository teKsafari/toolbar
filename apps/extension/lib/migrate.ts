// One-time move of the extension's storage keys from the old "nib:" prefix to "tb:" (D-111).
// The worker starts it first thing; the storage helpers wait for it, so a tester who updates
// keeps their sign-in, settings and draft list.
import { browser } from 'wxt/browser';
import { migrateLegacyKeys, type MigratableArea } from '@toolbar/shared/ext';

let done: Promise<void> | null = null;

export function migrateStorage(): Promise<void> {
  done ??= Promise.all(
    (['local', 'session'] as const).map((a) => migrateLegacyKeys(browser.storage[a] as unknown as MigratableArea).catch(() => [])),
  ).then(() => undefined);
  return done;
}
