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
  /** Better Auth's provider id; the callback is <PUBLIC_URL>/api/auth/callback/<providerId> */
  providerId: string;
  /** the issuer URL, stored on every capture and comment as the author's `iss` */
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  /** button label: "Sign in with <name>" */
  name: string;
}

const WELL_KNOWN = '/.well-known/openid-configuration';

/**
 * The one OIDC provider of docs/scope.md ("Sign-in", D-114): OIDC_ISSUER or OIDC_DISCOVERY_URL,
 * OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_SCOPES, OIDC_PROVIDER_NAME, OIDC_PROVIDER_ID. Google
 * Workspace: OIDC_ISSUER=https://accounts.google.com. The older OIDC_1_* names still work when
 * OIDC_CLIENT_ID is unset. Null when no provider is configured.
 */
export function oidcProviderFromEnv(): OidcProviderEnv | null {
  const legacy = !read('OIDC_CLIENT_ID') && !!read('OIDC_1_CLIENT_ID');
  const v = (name: string, old: string, fallback = '') => (legacy ? read(`OIDC_1_${old}`, fallback) : read(`OIDC_${name}`, fallback));
  const clientId = v('CLIENT_ID', 'CLIENT_ID');
  let issuer = (legacy ? '' : read('OIDC_ISSUER')).replace(/\/+$/, '');
  let discoveryUrl = v('DISCOVERY_URL', 'DISCOVERY_URL');
  if (!discoveryUrl && issuer) discoveryUrl = issuer + WELL_KNOWN;
  // OpenID Connect Discovery 1.0 section 4: the document lives at <issuer>/.well-known/openid-configuration
  if (!issuer && discoveryUrl.endsWith(WELL_KNOWN)) issuer = discoveryUrl.slice(0, -WELL_KNOWN.length);
  if (!clientId || !discoveryUrl) return null;
  const host = (() => {
    try {
      return new URL(issuer || discoveryUrl).hostname;
    } catch {
      return '';
    }
  })();
  return {
    providerId: v('PROVIDER_ID', 'ID', 'oidc'),
    issuer: issuer || discoveryUrl,
    discoveryUrl,
    clientId,
    clientSecret: v('CLIENT_SECRET', 'CLIENT_SECRET'),
    scopes: v('SCOPES', 'SCOPES', 'openid email profile').split(/[\s,]+/).filter(Boolean),
    name: v('PROVIDER_NAME', 'NAME', host === 'accounts.google.com' ? 'Google' : 'SSO'),
  };
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
    /** empty: no mail leaves the server (docs/scope.md: no SMTP); used only with FEATURE_EMAIL; read on use like it */
    get smtpUrl() {
      return read('SMTP_URL');
    },
    /** empty: `<instance name> <noreply@<PUBLIC_URL host>>` (D-112) */
    mailFrom: read('MAIL_FROM'),
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
      /**
       * Work-email sign-in link by mail (J-217): paused with the rest of mail, so it needs
       * FEATURE_EMAIL; AUTH_MAGIC_LINK=0 keeps it off even then (D-114).
       */
      magicLink: flag('FEATURE_EMAIL', false) && flag('AUTH_MAGIC_LINK', true),
      /**
       * Email domains that may sign in and submit feedback, comma separated (docs/scope.md,
       * "Sign-in"); empty lets any address in. Google's `hd` claim, when sent, must match too.
       * AUTH_ALLOWED_DOMAINS is the older name.
       */
      allowedDomains: read('ALLOWED_EMAIL_DOMAINS', read('AUTH_ALLOWED_DOMAINS'))
        .split(/[\s,]+/)
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
      oidc: oidcProviderFromEnv(),
      /**
       * Better Auth's per-address limits (3 sign-ins per 10 s). On by default in production; an
       * e2e run turns it off, because its many test accounts all sign in from one address.
       */
      rateLimit: flag('AUTH_RATE_LIMIT', read('NODE_ENV', 'development') === 'production'),
    },
    /**
     * Instance branding (D-112). Each set value wins over the admin UI and locks that field there.
     * Empty: the stored value, else the default (open-toolbar, the rectangle, ink 600).
     */
    brand: {
      name: read('APP_NAME'),
      logoUrl: read('APP_LOGO_URL'),
      logoDarkUrl: read('APP_LOGO_DARK_URL'),
      accent: read('APP_ACCENT'),
    },
    /** Instance admins by verified email, comma separated; empty means the first account (D-112). */
    adminEmails: read('ADMIN_EMAILS')
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    /**
     * The injector (apps/injector, D-130): INJECTOR_SECRET is the HMAC key shared with it (empty
     * turns /review/start off); INJECTOR_ORIGINS lists the app origins it fronts, comma separated;
     * INJECTOR_COOKIE_DAYS is how long a reviewer cookie lasts.
     */
    injector: {
      secret: read('INJECTOR_SECRET'),
      origins: read('INJECTOR_ORIGINS')
        .split(/[\s,]+/)
        .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
        .filter(Boolean),
      cookieDays: Math.min(90, Math.max(1, Number(read('INJECTOR_COOKIE_DAYS', '7')) || 7)),
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
  if (e.injector.secret && e.injector.secret.length < 32) bad.push('INJECTOR_SECRET');
  return bad;
}
