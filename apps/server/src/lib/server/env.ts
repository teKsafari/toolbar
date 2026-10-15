// Runtime configuration from process.env, with dev defaults that match docker-compose.yml.
// Every variable is listed in the root .env.example.

const DEV_SECRET = 'dev-only-change-me-0000000000000000';
const DEV_S3_KEY = 'GK000000000000000000000000';
const DEV_S3_SECRET = '0000000000000000000000000000000000000000000000000000000000000000';

const read = (name: string, fallback = ''): string => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};
const flag = (name: string, fallback: boolean) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v);
};

export interface OidcProviderEnv {
  providerId: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  name: string;
}

/** OIDC_1_ID, OIDC_1_NAME, OIDC_1_DISCOVERY_URL, OIDC_1_CLIENT_ID, OIDC_1_CLIENT_SECRET, OIDC_1_SCOPES; then OIDC_2_* ... */
export function oidcProvidersFromEnv(): OidcProviderEnv[] {
  const out: OidcProviderEnv[] = [];
  for (let n = 1; n <= 9; n++) {
    const p = `OIDC_${n}_`;
    const providerId = read(p + 'ID');
    const discoveryUrl = read(p + 'DISCOVERY_URL');
    const clientId = read(p + 'CLIENT_ID');
    if (!providerId || !discoveryUrl || !clientId) continue;
    out.push({
      providerId,
      name: read(p + 'NAME', providerId),
      discoveryUrl,
      clientId,
      clientSecret: read(p + 'CLIENT_SECRET'),
      scopes: read(p + 'SCOPES', 'openid email profile').split(/[\s,]+/).filter(Boolean),
    });
  }
  return out;
}

export function loadEnv() {
  const publicUrl = read('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, '');
  return {
    publicUrl,
    nodeEnv: read('NODE_ENV', 'development'),
    databaseUrl: read('DATABASE_URL', 'postgres://toolbar:toolbar@localhost:5432/toolbar'),
    authSecret: read('BETTER_AUTH_SECRET', DEV_SECRET),
    s3: {
      endpoint: read('S3_ENDPOINT', 'http://localhost:3900'),
      region: read('S3_REGION', 'garage'),
      bucket: read('S3_BUCKET', 'toolbar'),
      accessKeyId: read('S3_ACCESS_KEY_ID', DEV_S3_KEY),
      secretAccessKey: read('S3_SECRET_ACCESS_KEY', DEV_S3_SECRET),
      publicUrl: read('S3_PUBLIC_URL'),
      /** Key prefix inside the bucket, e.g. "capture/" for an area worktree (docs/parallel.md). */
      keyPrefix: read('S3_KEY_PREFIX'),
    },
    /** Paused features (docs/scope.md): off unless the flag is set. */
    features: {
      /** every notification and invite mail (FEATURE_EMAIL, D-079); read on use, so tests can turn it on */
      get email() {
        return flag('FEATURE_EMAIL', false);
      },
      /** GitHub and GitLab issue trackers, send to app, linked issues (FEATURE_TRACKERS, D-078) */
      get trackers() {
        return flag('FEATURE_TRACKERS', false);
      },
      /** Slack incoming webhook (FEATURE_SLACK, D-078) */
      get slack() {
        return flag('FEATURE_SLACK', false);
      },
      /** the `open-toolbar` command-line tool, its settings page and pointers to it (FEATURE_CLI, D-078) */
      get cli() {
        return flag('FEATURE_CLI', false);
      },
      /** AI titles, chapters and the workspace AI switch (FEATURE_AI, D-084) */
      get ai() {
        return flag('FEATURE_AI', false);
      },
      /** data retention (auto-delete) and the audit log (FEATURE_ADMIN_EXTRAS, D-084) */
      get adminExtras() {
        return flag('FEATURE_ADMIN_EXTRAS', false);
      },
    },
    smtpUrl: read('SMTP_URL', 'smtp://localhost:1025'),
    mailFrom: read('MAIL_FROM', 'open-toolbar <noreply@localhost>'),
    transcribe: {
      provider: read('TRANSCRIBE_PROVIDER', 'whispercpp') as 'whispercpp' | 'openai-compatible' | 'none',
      whisperUrl: read('WHISPER_URL', 'http://localhost:8080'),
      sttUrl: read('STT_URL'),
      sttApiKey: read('STT_API_KEY'),
      sttModel: read('STT_MODEL', 'whisper-1'),
    },
    extensionIds: read('EXTENSION_IDS').split(/[\s,]+/).filter(Boolean),
    auth: {
      /**
       * Email and password sign-in: development and tests only, off by default (docs/scope.md,
       * D-080). AUTH_DEV_PASSWORD=1 turns it on; the older AUTH_EMAIL_PASSWORD name still works.
       */
      emailPassword: flag('AUTH_DEV_PASSWORD', flag('AUTH_EMAIL_PASSWORD', false)),
      /** work-email sign-in link by mail (J-217); paused with the rest of mail unless FEATURE_EMAIL is on */
      magicLink: flag('AUTH_MAGIC_LINK', flag('FEATURE_EMAIL', false)),
      /**
       * Email domains that may sign in, comma separated (docs/scope.md, "Sign-in"); empty lets any
       * address in. Google's `hd` claim, when sent, must match too.
       */
      allowedDomains: read('AUTH_ALLOWED_DOMAINS')
        .split(/[\s,]+/)
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
      google: { clientId: read('GOOGLE_CLIENT_ID'), clientSecret: read('GOOGLE_CLIENT_SECRET') },
      github: { clientId: read('GITHUB_CLIENT_ID'), clientSecret: read('GITHUB_CLIENT_SECRET') },
      oidc: oidcProvidersFromEnv(),
      /**
       * Better Auth's per-address limits (3 sign-ins per 10 s). On by default in production; an
       * e2e run turns it off, because its many test accounts all sign in from one address.
       */
      rateLimit: flag('AUTH_RATE_LIMIT', read('NODE_ENV', 'development') === 'production'),
    },
    worker: flag('WORKER', true),
    migrateOnStart: flag('MIGRATE_ON_START', true),
    testMode: flag('TEST_MODE', false),
  };
}

export type Env = ReturnType<typeof loadEnv>;

/** The paused-feature flags as plain values, for page data (the UI hides what is off). */
export function featureFlags(e: Pick<Env, 'features'> = env) {
  return {
    email: e.features.email,
    trackers: e.features.trackers,
    slack: e.features.slack,
    cli: e.features.cli,
    ai: e.features.ai,
    adminExtras: e.features.adminExtras,
  };
}
export type FeatureFlags = ReturnType<typeof featureFlags>;
export const env: Env = loadEnv();

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(u);

/** Refuse to run on a public URL with a dev default secret (architecture section 13). */
export function assertSafeSecrets(e: Env = env): string[] {
  if (isLocal(e.publicUrl)) return [];
  const bad: string[] = [];
  if (e.authSecret === DEV_SECRET) bad.push('BETTER_AUTH_SECRET');
  if (e.s3.accessKeyId === DEV_S3_KEY) bad.push('S3_ACCESS_KEY_ID');
  if (e.s3.secretAccessKey === DEV_S3_SECRET) bad.push('S3_SECRET_ACCESS_KEY');
  return bad;
}
