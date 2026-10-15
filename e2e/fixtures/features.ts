// Paused features (docs/scope.md): their tests run only when the server under test has the flag
// on, which it reports in /api/health (`features`, D-114). Otherwise they skip with the reason
// "paused (docs/scope.md)". Flags: FEATURE_EMAIL, FEATURE_TRACKERS, FEATURE_SLACK, FEATURE_CLI,
// FEATURE_AI, FEATURE_ADMIN_EXTRAS.
import type { TestType } from '@playwright/test';

export type Feature = 'email' | 'trackers' | 'slack' | 'cli' | 'ai' | 'adminExtras';
const FLAG: Record<Feature, string> = {
  email: 'FEATURE_EMAIL',
  trackers: 'FEATURE_TRACKERS',
  slack: 'FEATURE_SLACK',
  cli: 'FEATURE_CLI',
  ai: 'FEATURE_AI',
  adminExtras: 'FEATURE_ADMIN_EXTRAS',
};

const cache = new Map<string, Promise<Set<string>>>();

/** The paused features the server has on. */
export function serverFeatures(server = process.env.SERVER_URL ?? 'http://localhost:3000'): Promise<Set<string>> {
  let p = cache.get(server);
  if (!p) {
    p = fetch(`${server}/api/health`)
      .then((r) => r.json() as Promise<{ features?: string[] }>)
      .then((h) => new Set(h.features ?? []))
      .catch(() => new Set<string>());
    cache.set(server, p);
  }
  return p;
}

export const featureOn = async (f: Feature, server?: string) => (await serverFeatures(server)).has(f);

/** The skip reason of a paused feature's test. */
export const pausedReason = (...fs: Feature[]) => `paused (docs/scope.md): needs ${fs.map((f) => `${FLAG[f]}=1`).join(' and ')} on the server`;

/**
 * Skip the running test (call it inside the test or a beforeEach) unless every named feature is
 * on in the server under test.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function skipUnlessFeature(test: TestType<any, any>, ...fs: Feature[]) {
  const on = await serverFeatures();
  test.skip(!fs.every((f) => on.has(f)), pausedReason(...fs));
}
