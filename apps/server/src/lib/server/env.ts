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
    smtpUrl: read('SMTP_URL', 'smtp://localhost:1025'),
    mailFrom: read('MAIL_FROM', 'Nib <nib@localhost>'),
    transcribe: {
      provider: read('TRANSCRIBE_PROVIDER', 'whispercpp') as 'whispercpp' | 'openai-compatible' | 'none',
      whisperUrl: read('WHISPER_URL', 'http://localhost:8080'),
      sttUrl: read('STT_URL'),
      sttApiKey: read('STT_API_KEY'),
      sttModel: read('STT_MODEL', 'whisper-1'),
    },
    extensionIds: read('EXTENSION_IDS').split(/[\s,]+/).filter(Boolean),
    auth: {
      emailPassword: flag('AUTH_EMAIL_PASSWORD', true),
      /** work-email sign-in link by mail (J-217) */
      magicLink: flag('AUTH_MAGIC_LINK', true),
      google: { clientId: read('GOOGLE_CLIENT_ID'), clientSecret: read('GOOGLE_CLIENT_SECRET') },
      github: { clientId: read('GITHUB_CLIENT_ID'), clientSecret: read('GITHUB_CLIENT_SECRET') },
      oidc: oidcProvidersFromEnv(),
    },
    worker: flag('WORKER', true),
    migrateOnStart: flag('MIGRATE_ON_START', true),
    testMode: flag('TEST_MODE', false),
  };
}

export type Env = ReturnType<typeof loadEnv>;
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
