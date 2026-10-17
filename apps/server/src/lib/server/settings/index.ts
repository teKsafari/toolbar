// Instance settings (D-194): Settings > Server stores them in `instance_setting` row `instance`;
// an environment variable that is set wins and locks the field (as branding, D-112). Readers call
// the synchronous `setting(key)`, which works from a cache that `refreshSettings(db)` fills: the
// request hook and the job worker refresh it at most every 15 s, and a save replaces it at once,
// so a change takes effect without a restart. The API key is sealed at rest (crypto.ts) and is
// never handed back in full.
import { eq } from 'drizzle-orm';
import {
  INSTANCE_FIELD,
  INSTANCE_FIELDS,
  INSTANCE_KEYS,
  parseInstanceValue,
  type AdminInstanceSettings,
  type InstanceKey,
  type InstanceValues,
} from '@toolbar/shared/api';
import { TRACE_OPEN_MS } from '@toolbar/shared/projects';
import type { Db } from '../db/index.ts';
import { instanceSetting } from '../db/schema/index.ts';
import { seal, unseal } from '../crypto.ts';
import { env, isLocalUrl } from '../env.ts';

export const SETTING_KEY = 'instance';
const TTL_MS = 15_000;
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_HOSTED_MODEL = 'gpt-transcribe';
const SECRET: InstanceKey = 'transcribeApiKey';

type Values = InstanceValues;
type Stored = Partial<{ [K in InstanceKey]: NonNullable<Values[K]> }>;

let stored: Stored = {};
let loadedAt = 0;
let pending: Promise<void> | null = null;
const warned = new Set<string>();
const warnOnce = (m: string) => {
  if (warned.has(m)) return;
  warned.add(m);
  console.warn(`[settings] ${m}`);
};

// ---------------------------------------------------------------- environment

const raw = (name: string, src: NodeJS.ProcessEnv): string => (src[name] ?? '').trim();

/** Numeric env values outside the range are clamped (the behaviour before D-194). */
const RANGE: Partial<Record<InstanceKey, [number, number, boolean]>> = {
  transcribeChunkSeconds: [5, 600, false],
  transcribeConcurrency: [1, 16, true],
  maxRecordingMin: [1, 100_000, true],
  defaultTraceOpenMs: [TRACE_OPEN_MS.min, TRACE_OPEN_MS.max, true],
  shareLinkDays: [0, 3650, true],
  exportMaxMb: [1, 10_000, true],
  transcribeMaxMinutes: [0.1, 1440, false],
  transcribeMonthlyMinutes: [0, 10_000_000, false],
  recordingLinkRateLimit: [1, 1000, true],
};

/** TRANSCRIBE_PROVIDER: `none` (also `off`, `0`), `local` or `openai`; anything else is not valid. */
export function normaliseProvider(v: string): 'local' | 'openai' | 'none' | undefined {
  const s = v.toLowerCase();
  if (s === 'none' || s === 'off' || s === '0') return 'none';
  if (s === 'openai' || s === 'local') return s;
  return undefined;
}

const splitList = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** Parse an environment value leniently, as the variables were read before they became settings. */
function fromEnv(key: InstanceKey, v: string): unknown {
  switch (key) {
    case 'allowedEmailDomains':
      return splitList(v).map((d) => d.toLowerCase().replace(/^@/, ''));
    case 'oidcScopes':
      return splitList(v);
    case 'transcribeLanguage':
      return splitList(v).map((l) => l.toLowerCase()).filter((l) => /^[a-z]{2,3}$/.test(l));
    case 'transcribeProvider':
      return normaliseProvider(v);
    case 'transcribeTimestamps': {
      const t = v.toLowerCase();
      return t === 'chunked' || t === 'native' ? t : 'auto';
    }
    case 'siteAccess': {
      const s = v.toLowerCase();
      return s === 'all' || s === 'projects' ? s : undefined;
    }
    case 'transcribeBaseUrl':
    case 'whisperUrl':
      return v.replace(/\/+$/, '');
    default: {
      const range = RANGE[key];
      if (!range) return v;
      const n = Number(v);
      if (!Number.isFinite(n)) return undefined;
      const [min, max, int] = range;
      if (key === 'maxRecordingMin' && n <= 0) return undefined;
      const c = Math.min(max, Math.max(min, n));
      return int ? Math.round(c) : c;
    }
  }
}

/** The environment variable that sets this field, with its parsed value; null when none is set. */
export function envOverride(key: InstanceKey, src: NodeJS.ProcessEnv = process.env): { name: string; value: unknown } | null {
  for (const name of INSTANCE_FIELD[key].env) {
    const v = raw(name, src);
    if (!v) continue;
    const value = fromEnv(key, v);
    if (value === undefined) {
      warnOnce(`${name}=${v} is not a valid value; ignored`);
      continue;
    }
    return { name, value };
  }
  return null;
}

// ---------------------------------------------------------------- defaults

function googleIssuer(): boolean {
  try {
    return new URL(env.auth.oidc?.issuer ?? '').hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}

/** Defaults when neither the environment nor an admin sets a field. */
export function defaultOf<K extends InstanceKey>(key: K): Values[K] {
  const d: { [P in InstanceKey]: () => Values[P] } = {
    allowedEmailDomains: () => [],
    oidcProviderName: () => (googleIssuer() ? 'Google' : 'SSO'),
    oidcScopes: () => ['openid', 'email', 'profile'],
    // off until an admin picks a provider (D-194); whisper is an extra compose file
    transcribeProvider: () => 'none',
    transcribeModel: () => DEFAULT_HOSTED_MODEL,
    transcribeApiKey: () => null,
    transcribeBaseUrl: () => OPENAI_BASE_URL,
    whisperUrl: () => 'http://localhost:8080',
    transcribeLanguage: () => [],
    transcribeTimestamps: () => 'auto',
    transcribeChunkSeconds: () => 30,
    transcribeConcurrency: () => 4,
    maxRecordingMin: () => null,
    // D-203: project origins only; `all` (D-200) is an admin's opt-in
    siteAccess: () => 'projects',
    defaultMaskingPreset: () => 'staging',
    defaultTraceOpenMs: () => TRACE_OPEN_MS.default,
    shareLinkDays: () => 14,
    exportMaxMb: () => 200,
    supportRecordingLink: () => null,
    transcribeMaxMinutes: () => 60,
    transcribeMonthlyMinutes: () => null,
    recordingLinkRateLimit: () => 10,
  };
  return d[key]() as Values[K];
}

// ---------------------------------------------------------------- resolve

/** The effective value: environment, else stored, else default. Synchronous; see refreshSettings. */
export function setting<K extends InstanceKey>(key: K, src: NodeJS.ProcessEnv = process.env): Values[K] {
  const e = envOverride(key, src);
  if (e) return e.value as Values[K];
  if (stored[key] !== undefined) return stored[key] as Values[K];
  return defaultOf(key);
}

/** The email-domain allowlist (docs/scope.md, "Sign-in"): empty admits anyone the provider signs in. */
export const allowedDomains = (): string[] => setting('allowedEmailDomains') ?? [];

function decode(row: unknown): Stored {
  const src = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const out: Stored = {};
  for (const key of INSTANCE_KEYS) {
    if (!(key in src)) continue;
    let v = src[key];
    if (key === SECRET) {
      try {
        v = unseal(Buffer.from(String((v as { sealed?: string })?.sealed ?? ''), 'base64'), 'instance-secret');
      } catch {
        warnOnce('the stored transcription API key cannot be decrypted (BETTER_AUTH_SECRET changed?); set it again');
        continue;
      }
    }
    const r = parseInstanceValue(key, v);
    if (r.ok) (out as Record<string, unknown>)[key] = r.value;
  }
  return out;
}

function encode(s: Stored): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s };
  if (s[SECRET]) out[SECRET] = { sealed: seal(String(s[SECRET]), 'instance-secret').toString('base64') };
  return out;
}

async function readRow(db: Db): Promise<unknown> {
  const [row] = await db.select({ value: instanceSetting.value }).from(instanceSetting).where(eq(instanceSetting.key, SETTING_KEY));
  return row?.value ?? null;
}

/** Load the stored settings when the cache is older than 15 s (or always with `force`). */
export async function refreshSettings(db: Db, force = false): Promise<void> {
  if (!force && loadedAt && Date.now() - loadedAt < TTL_MS) return;
  pending ??= readRow(db)
    .then((row) => {
      stored = decode(row);
      loadedAt = Date.now();
    })
    .catch((e) => {
      // a database that is not ready yet: keep what we have, try again on the next call
      warnOnce(`stored settings unreadable (${(e as Error).message})`);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Forget the cache: the next refreshSettings reads the database. */
export function invalidateSettings() {
  loadedAt = 0;
}

/** Test hook: replace the cached stored values without a database. */
export function _setStoredForTest(s: Stored) {
  stored = s;
  loadedAt = Date.now();
}

// ---------------------------------------------------------------- admin

const mask = (k: string) => (k.length > 8 ? `...${k.slice(-4)}` : '...');

export function adminView(): AdminInstanceSettings {
  const values: Record<string, unknown> = {};
  const locked: Record<string, string | null> = {};
  const isStored: Record<string, boolean> = {};
  const defaults: Record<string, unknown> = {};
  for (const f of INSTANCE_FIELDS) {
    const v = setting(f.key);
    values[f.key] = f.key === SECRET ? (v ? mask(String(v)) : null) : v;
    locked[f.key] = envOverride(f.key)?.name ?? null;
    isStored[f.key] = stored[f.key] !== undefined;
    defaults[f.key] = f.key === SECRET ? null : defaultOf(f.key);
  }
  const o = env.auth.oidc;
  const providerId = o?.providerId ?? 'oidc';
  return {
    values,
    locked,
    stored: isStored,
    defaults,
    oidc: { configured: !!o, issuer: o?.issuer ?? null, discoveryUrl: o?.discoveryUrl ?? null, providerId, redirectUri: `${env.publicUrl}/api/auth/callback/${providerId}` },
    bootstrap: { publicUrl: !isLocalUrl(env.publicUrl), adminEmails: env.adminEmails.length > 0, openSignIn: allowedDomains().length === 0 },
  };
}

export class SettingsError extends Error {
  readonly code: 'invalid_body' | 'locked_by_env';
  readonly key?: string;
  // no parameter properties: scripts run this file under Node's type stripping
  constructor(code: 'invalid_body' | 'locked_by_env', message: string, key?: string) {
    super(message);
    this.code = code;
    this.key = key;
  }
}

/** Validate a partial update without writing it: the next stored values. */
export function applyPatch(cur: Stored, patch: Record<string, unknown>): Stored {
  const next: Stored = { ...cur };
  for (const [key, v] of Object.entries(patch)) {
    if (!(INSTANCE_KEYS as string[]).includes(key)) throw new SettingsError('invalid_body', `Unknown setting ${key}`, key);
    const k = key as InstanceKey;
    const spec = INSTANCE_FIELD[k];
    const lock = envOverride(k);
    if (lock) throw new SettingsError('locked_by_env', `${spec.label} is set by ${lock.name} on the server.`, key);
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) {
      delete next[k];
      continue;
    }
    const r = parseInstanceValue(k, v);
    if (!r.ok) throw new SettingsError('invalid_body', `${spec.label}: ${r.message}`, key);
    (next as Record<string, unknown>)[k] = r.value;
  }
  return next;
}

/** Store a partial update; null or an empty string resets a field. Effective at once. */
export async function updateSettings(db: Db, userId: string, patch: Record<string, unknown>): Promise<AdminInstanceSettings> {
  await refreshSettings(db, true);
  const next = applyPatch(stored, patch);
  const value = encode(next);
  await db
    .insert(instanceSetting)
    .values({ key: SETTING_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
  stored = next;
  loadedAt = Date.now();
  return adminView();
}

/** The stored value of one field, for code that must tell "set by an admin" from the default. */
export const storedValue = <K extends InstanceKey>(key: K): Stored[K] => stored[key];
