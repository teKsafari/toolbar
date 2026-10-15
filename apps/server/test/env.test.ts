import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadEnv, oidcProviderFromEnv, assertSafeSecrets, featureFlags } from '../src/lib/server/env.ts';
import { claimsRefusal, domainAllowed } from '../src/lib/server/auth/allowlist.ts';

const saved = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (/^(OIDC_|PUBLIC_URL|BETTER_AUTH|S3_|AUTH_|ALLOWED_EMAIL_DOMAINS|FEATURE_|SMTP_URL)/.test(k)) delete process.env[k];
});
afterEach(() => {
  process.env = { ...saved };
});

describe('env', () => {
  it('reads the one OIDC provider from OIDC_ISSUER and derives the discovery URL', () => {
    Object.assign(process.env, { OIDC_ISSUER: 'https://accounts.google.com/', OIDC_CLIENT_ID: 'cid', OIDC_CLIENT_SECRET: 'sec' });
    expect(oidcProviderFromEnv()).toEqual({
      providerId: 'oidc',
      issuer: 'https://accounts.google.com',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      clientId: 'cid',
      clientSecret: 'sec',
      scopes: ['openid', 'email', 'profile'],
      name: 'Google',
    });
  });

  it('takes OIDC_DISCOVERY_URL, scopes and a button name; derives the issuer from the discovery URL', () => {
    Object.assign(process.env, {
      OIDC_DISCOVERY_URL: 'https://kc.example/realms/eng/.well-known/openid-configuration',
      OIDC_CLIENT_ID: 'x',
      OIDC_SCOPES: 'openid,email groups',
      OIDC_PROVIDER_NAME: 'Keycloak',
      OIDC_PROVIDER_ID: 'kc',
    });
    expect(oidcProviderFromEnv()).toMatchObject({ providerId: 'kc', issuer: 'https://kc.example/realms/eng', scopes: ['openid', 'email', 'groups'], name: 'Keycloak' });
  });

  it('has no provider without a client id, and still reads the older OIDC_1_* names', () => {
    process.env.OIDC_ISSUER = 'https://id.example';
    expect(oidcProviderFromEnv()).toBeNull();
    delete process.env.OIDC_ISSUER;
    Object.assign(process.env, { OIDC_1_ID: 'corp', OIDC_1_DISCOVERY_URL: 'https://id.example/.well-known/openid-configuration', OIDC_1_CLIENT_ID: 'cid', OIDC_1_NAME: 'Corp' });
    expect(oidcProviderFromEnv()).toMatchObject({ providerId: 'corp', issuer: 'https://id.example', name: 'Corp' });
    expect(loadEnv().auth.oidc?.providerId).toBe('corp');
  });

  it('reads ALLOWED_EMAIL_DOMAINS (and the older AUTH_ALLOWED_DOMAINS)', () => {
    process.env.AUTH_ALLOWED_DOMAINS = 'old.example';
    expect(loadEnv().auth.allowedDomains).toEqual(['old.example']);
    process.env.ALLOWED_EMAIL_DOMAINS = '@Acme.com, sub.acme.io';
    expect(loadEnv().auth.allowedDomains).toEqual(['acme.com', 'sub.acme.io']);
  });

  it('turns the magic link on only with FEATURE_EMAIL, and sends no mail without SMTP_URL', () => {
    expect(loadEnv().auth.magicLink).toBe(false);
    expect(loadEnv().smtpUrl).toBe('');
    process.env.FEATURE_EMAIL = '1';
    expect(loadEnv().auth.magicLink).toBe(true);
    process.env.AUTH_MAGIC_LINK = '0';
    expect(loadEnv().auth.magicLink).toBe(false);
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

  it('allowlist: domains and subdomains, the hd claim, unverified addresses', () => {
    const list = ['acme.com'];
    expect(domainAllowed('a@acme.com', list)).toBe(true);
    expect(domainAllowed('a@eu.acme.com', list)).toBe(true);
    expect(domainAllowed('a@notacme.com', list)).toBe(false);
    expect(domainAllowed('a@acme.com.evil.io', list)).toBe(false);
    expect(domainAllowed('nobody', list)).toBe(false);
    expect(domainAllowed('a@anything.io', [])).toBe(true);
    expect(claimsRefusal({ email: 'a@acme.com', email_verified: true, hd: 'acme.com' }, list)).toBeNull();
    expect(claimsRefusal({ email: 'a@acme.com', email_verified: true, hd: 'other.com' }, list)).toBe('hd');
    expect(claimsRefusal({ email: 'a@acme.com', email_verified: false }, list)).toBe('unverified');
    expect(claimsRefusal({ email: 'a@gmail.com', email_verified: true }, list)).toBe('domain');
    expect(claimsRefusal({ email: 'a@gmail.com', email_verified: false }, [])).toBeNull();
  });

  it('allows dev secrets on localhost only', () => {
    expect(assertSafeSecrets(loadEnv())).toEqual([]);
    process.env.PUBLIC_URL = 'https://toolbar.example.com';
    expect(assertSafeSecrets(loadEnv())).toEqual(['BETTER_AUTH_SECRET']);
    process.env.AUTH_SECRET = 'x'.repeat(40);
    expect(assertSafeSecrets(loadEnv())).toEqual([]);
    process.env.S3_PUBLIC_URL = 'https://s3.example.com';
    expect(assertSafeSecrets(loadEnv())).toEqual(['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
    delete process.env.AUTH_SECRET;
    delete process.env.S3_PUBLIC_URL;
  });
});
