import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadEnv, oidcProvidersFromEnv, assertSafeSecrets, featureFlags } from '../src/lib/server/env.ts';

const saved = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (/^(OIDC_|PUBLIC_URL|BETTER_AUTH|S3_|GOOGLE_|GITHUB_|AUTH_DEV_PASSWORD|AUTH_EMAIL_PASSWORD)/.test(k)) delete process.env[k];
});
afterEach(() => {
  process.env = { ...saved };
});

describe('env', () => {
  it('reads numbered OIDC providers and skips incomplete ones', () => {
    Object.assign(process.env, {
      OIDC_1_ID: 'corp',
      OIDC_1_DISCOVERY_URL: 'https://id.example/.well-known/openid-configuration',
      OIDC_1_CLIENT_ID: 'cid',
      OIDC_2_ID: 'half',
      OIDC_3_ID: 'kc',
      OIDC_3_NAME: 'Keycloak',
      OIDC_3_DISCOVERY_URL: 'https://kc/.well-known/openid-configuration',
      OIDC_3_CLIENT_ID: 'x',
      OIDC_3_SCOPES: 'openid,email groups',
    });
    const p = oidcProvidersFromEnv();
    expect(p.map((x) => x.providerId)).toEqual(['corp', 'kc']);
    expect(p[0]!.scopes).toEqual(['openid', 'email', 'profile']);
    expect(p[1]!.scopes).toEqual(['openid', 'email', 'groups']);
    expect(p[1]!.name).toBe('Keycloak');
  });

  it('has dev defaults that match docker-compose.yml', () => {
    const e = loadEnv();
    expect(e.publicUrl).toBe('http://localhost:3000');
    expect(e.s3.bucket).toBe('toolbar');
    expect(e.auth.emailPassword).toBe(false);
  });

  it('keeps paused features and password sign-in off unless their flags are set', () => {
    for (const k of ['FEATURE_EMAIL', 'FEATURE_TRACKERS', 'FEATURE_SLACK', 'FEATURE_CLI', 'FEATURE_AI', 'FEATURE_ADMIN_EXTRAS', 'AUTH_DEV_PASSWORD', 'AUTH_EMAIL_PASSWORD']) delete process.env[k];
    expect(featureFlags(loadEnv())).toEqual({ email: false, trackers: false, slack: false, cli: false, ai: false, adminExtras: false });
    expect(loadEnv().auth.emailPassword).toBe(false);
    process.env.AUTH_DEV_PASSWORD = '1';
    process.env.FEATURE_CLI = 'true';
    expect(loadEnv().auth.emailPassword).toBe(true);
    expect(featureFlags(loadEnv()).cli).toBe(true);
  });

  it('allows dev secrets on localhost only', () => {
    expect(assertSafeSecrets(loadEnv())).toEqual([]);
    process.env.PUBLIC_URL = 'https://nib.example.com';
    expect(assertSafeSecrets(loadEnv())).toEqual(['BETTER_AUTH_SECRET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
  });
});
