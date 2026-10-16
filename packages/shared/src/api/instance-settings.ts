// Instance settings (D-194): what an instance admin changes in Settings > Server at runtime,
// stored in `instance_setting` row `instance`. Precedence per field, as branding (D-112): an
// environment variable that is set wins and locks the field, else the stored value, else the
// default. The specs below drive the server's resolver, the admin API and the settings page.
import { z } from 'zod';
import { api, defineRoute } from './common.ts';
import { PROJECT_PRESETS, TRACE_OPEN_MS } from '../projects.ts';

export const INSTANCE_SECTIONS = [
  { id: 'signin', title: 'Sign-in', description: 'Who may sign in, and how the sign-in button reads.' },
  { id: 'transcription', title: 'Transcription', description: 'How voice notes and narrated recordings become text.' },
  { id: 'capture', title: 'Capture defaults', description: 'Defaults for new projects and recordings. Workspace admins can change the project defaults for their workspace.' },
  { id: 'sharing', title: 'Sharing and export', description: 'Share links, the bulk export for agents, and the extension’s problem reports.' },
  { id: 'limits', title: 'Limits', description: 'Caps that keep cost and abuse in check.' },
] as const;
export type InstanceSectionId = (typeof INSTANCE_SECTIONS)[number]['id'];

export const TRANSCRIBE_PROVIDERS = ['none', 'local', 'openai'] as const;
export const TRANSCRIBE_TIMESTAMP_MODES = ['auto', 'chunked', 'native'] as const;

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Use an http(s) URL')
  .transform((s) => s.replace(/\/+$/, ''));

const list = (item: z.ZodType<string, string>, max: number) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item).max(max, `At most ${max} entries`))
    .transform((a) => [...new Set(a)]);

/** Value schemas per field: what an admin may store. `null` in an update resets to the default. */
export const instanceValueSchemas = {
  allowedEmailDomains: list(
    z.string().transform((d) => d.toLowerCase().replace(/^@/, '')).pipe(z.string().regex(DOMAIN_RE, 'Use domains such as example.com')),
    50,
  ),
  oidcProviderName: z.string().trim().min(1, 'Enter a name').max(40, 'At most 40 characters'),
  oidcScopes: list(z.string().regex(/^[\x21-\x7e]{1,100}$/, 'Scopes are single words'), 20).refine(
    (s) => s.includes('openid') && s.includes('email'),
    'Keep openid and email: the allowlist reads the address',
  ),
  transcribeProvider: z.enum(TRANSCRIBE_PROVIDERS),
  transcribeModel: z.string().trim().min(1, 'Enter a model id').max(100),
  transcribeApiKey: z.string().trim().min(1, 'Enter a key').max(500),
  transcribeBaseUrl: httpUrl,
  transcribeLanguage: list(z.string().transform((l) => l.toLowerCase()).pipe(z.string().regex(/^[a-z]{2,3}$/, 'Use ISO 639-1 codes such as sw or en')), 10),
  transcribeTimestamps: z.enum(TRANSCRIBE_TIMESTAMP_MODES),
  transcribeChunkSeconds: z.number().int().min(5, 'At least 5 s').max(600, 'At most 600 s'),
  transcribeConcurrency: z.number().int().min(1, 'At least 1').max(16, 'At most 16'),
  whisperUrl: httpUrl,
  maxRecordingMin: z.number().int().min(1, 'At least 1 minute').max(600, 'At most 600 minutes'),
  defaultMaskingPreset: z.enum(PROJECT_PRESETS),
  defaultTraceOpenMs: z
    .number()
    .int()
    .min(TRACE_OPEN_MS.min, `At least ${TRACE_OPEN_MS.min / 1000} s`)
    .max(TRACE_OPEN_MS.max, `At most ${TRACE_OPEN_MS.max / 1000} s`),
  shareLinkDays: z.number().int().min(0, '0 or more days').max(3650, 'At most 3650 days'),
  exportMaxMb: z.number().int().min(1, 'At least 1 MB').max(10_000, 'At most 10000 MB'),
  supportRecordingLink: z.union([z.literal('off'), httpUrl], { error: 'Use an http(s) URL, or off' }),
  transcribeMaxMinutes: z.number().min(0.1, 'At least 0.1 minutes').max(1440, 'At most 1440 minutes'),
  transcribeMonthlyMinutes: z.number().min(0, '0 or more minutes').max(10_000_000),
  recordingLinkRateLimit: z.number().int().min(1, 'At least 1').max(1000, 'At most 1000'),
} as const;

export type InstanceKey = keyof typeof instanceValueSchemas;
export type InstanceValues = { [K in InstanceKey]: z.output<(typeof instanceValueSchemas)[K]> | null };
export const INSTANCE_KEYS = Object.keys(instanceValueSchemas) as InstanceKey[];

export type InstanceFieldKind = 'list' | 'text' | 'url' | 'secret' | 'int' | 'number' | 'enum';

export interface InstanceFieldSpec {
  key: InstanceKey;
  section: InstanceSectionId;
  label: string;
  hint: string;
  kind: InstanceFieldKind;
  /** environment variables that override the field, in the order they are read */
  env: readonly string[];
  options?: readonly { value: string; label: string }[];
  /** shown in the input; for number fields the unit after it */
  unit?: string;
  /** stored units per unit the form shows: 1000 for a span window stored in ms and edited in seconds */
  scale?: number;
  placeholder?: string;
}

export const INSTANCE_FIELDS: readonly InstanceFieldSpec[] = [
  {
    key: 'allowedEmailDomains', section: 'signin', kind: 'list', label: 'Allowed email domains',
    env: ['ALLOWED_EMAIL_DOMAINS'], placeholder: 'acme.com, acme.co.uk',
    hint: 'Comma separated; subdomains count. Empty admits anyone your provider signs in. Removing a domain signs its people out at their next request.',
  },
  {
    key: 'oidcProviderName', section: 'signin', kind: 'text', label: 'Sign-in button name',
    env: ['OIDC_PROVIDER_NAME'], placeholder: 'Acme SSO',
    hint: 'The button reads "Sign in with <name>".',
  },
  {
    key: 'oidcScopes', section: 'signin', kind: 'list', label: 'Scopes',
    env: ['OIDC_SCOPES'], placeholder: 'openid email profile',
    hint: 'Space or comma separated. Keep openid and email.',
  },
  {
    key: 'transcribeProvider', section: 'transcription', kind: 'enum', label: 'Provider', env: ['TRANSCRIBE_PROVIDER'],
    options: [
      { value: 'none', label: 'Off' },
      { value: 'local', label: 'Local whisper.cpp (no key, audio stays on the server)' },
      { value: 'openai', label: 'OpenAI-compatible endpoint (sends voice audio to it)' },
    ],
    hint: 'Local needs the whisper container (docker-compose.whisper.yml). A hosted endpoint costs money and is much better on Swahili.',
  },
  {
    key: 'transcribeApiKey', section: 'transcription', kind: 'secret', label: 'API key',
    env: ['TRANSCRIBE_API_KEY', 'OPENAI_API_KEY'], placeholder: 'sk-...',
    hint: 'Stored encrypted. Only its last four characters are shown again.',
  },
  {
    key: 'transcribeModel', section: 'transcription', kind: 'text', label: 'Model', env: ['TRANSCRIBE_MODEL'],
    placeholder: 'gpt-transcribe', hint: 'Model id for the hosted endpoint. Groq takes whisper-large-v3-turbo.',
  },
  {
    key: 'transcribeBaseUrl', section: 'transcription', kind: 'url', label: 'Endpoint', env: ['TRANSCRIBE_BASE_URL'],
    placeholder: 'https://api.openai.com/v1', hint: 'With /v1. The server posts to <endpoint>/audio/transcriptions.',
  },
  {
    key: 'whisperUrl', section: 'transcription', kind: 'url', label: 'whisper.cpp URL', env: ['WHISPER_URL'],
    placeholder: 'http://whisper:8080', hint: 'Where the server reaches the local whisper.cpp server.',
  },
  {
    key: 'transcribeLanguage', section: 'transcription', kind: 'list', label: 'Languages', env: ['TRANSCRIBE_LANGUAGE'],
    placeholder: 'sw, en', hint: 'ISO 639-1 codes. Leave empty to detect; mixed narration does better without a hint.',
  },
  {
    key: 'transcribeTimestamps', section: 'transcription', kind: 'enum', label: 'Timestamps', env: ['TRANSCRIBE_TIMESTAMPS'],
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'chunked', label: 'Chunked: the server times the text' },
      { value: 'native', label: 'Native: the endpoint returns WebVTT' },
    ],
    hint: 'Auto uses chunked for gpt-* models and native elsewhere.',
  },
  {
    key: 'transcribeChunkSeconds', section: 'transcription', kind: 'int', label: 'Chunk length', unit: 's',
    env: ['TRANSCRIBE_CHUNK_SECONDS'], hint: 'Longest audio sent in one request. 12 s puts cues closer to the speech for about 4% more billed audio.',
  },
  {
    key: 'transcribeConcurrency', section: 'transcription', kind: 'int', label: 'Parallel requests',
    env: ['TRANSCRIBE_CONCURRENCY'], hint: 'Chunk requests in flight per recording. Lower it when the provider rate-limits you.',
  },
  {
    key: 'defaultMaskingPreset', section: 'capture', kind: 'enum', label: 'Masking preset for new projects', env: [],
    options: [
      { value: 'staging', label: 'Staging, own team' },
      { value: 'production', label: 'Production' },
    ],
    hint: 'Production masks all text and inputs and keeps bodies only for allowlisted URLs.',
  },
  {
    key: 'defaultTraceOpenMs', section: 'capture', kind: 'int', label: 'Trace step window for new projects', unit: 's', scale: 1000,
    env: [], hint: `How long an action's step stays open while its requests are in flight, ${TRACE_OPEN_MS.min / 1000} to ${TRACE_OPEN_MS.max / 1000} s.`,
  },
  {
    key: 'maxRecordingMin', section: 'capture', kind: 'int', label: 'Longest recording', unit: 'min', env: ['MAX_RECORDING_MIN'],
    hint: 'The extension stops recording there. Empty: no cap.',
  },
  {
    key: 'shareLinkDays', section: 'sharing', kind: 'int', label: 'Share link lifetime', unit: 'days', env: ['SHARE_LINK_DAYS'],
    hint: '0 makes new links never expire. Links made before a change keep their expiry.',
  },
  {
    key: 'exportMaxMb', section: 'sharing', kind: 'int', label: 'Export page size', unit: 'MB', env: ['EXPORT_MAX_MB'],
    hint: 'Stored media one page of the bulk export carries before it hands out a cursor for the next page.',
  },
  {
    key: 'supportRecordingLink', section: 'sharing', kind: 'text', label: '"Report a problem" link', env: ['SUPPORT_RECORDING_LINK'],
    placeholder: 'https://feedback.example.com/r/abc, or off',
    hint: 'Where the extension menu’s "report a problem" goes. Empty: a recording link owned by the server’s first account. off hides it.',
  },
  {
    key: 'transcribeMaxMinutes', section: 'limits', kind: 'number', label: 'Longest audio transcribed', unit: 'min', env: ['TRANSCRIBE_MAX_MINUTES'],
    hint: 'Longer audio gets a "skipped" transcript. Applies to every provider.',
  },
  {
    key: 'transcribeMonthlyMinutes', section: 'limits', kind: 'number', label: 'Hosted transcription per month', unit: 'min',
    env: ['TRANSCRIBE_MONTHLY_MINUTES'], hint: 'Calendar month, UTC. Empty: no cap. 6000 minutes of gpt-transcribe cost about $27.',
  },
  {
    key: 'recordingLinkRateLimit', section: 'limits', kind: 'int', label: 'Recording link uploads', unit: 'per 10 min', env: [],
    hint: 'Recordings one address may start through one public recording link in 10 minutes.',
  },
];

export const INSTANCE_FIELD = Object.fromEntries(INSTANCE_FIELDS.map((f) => [f.key, f])) as Record<InstanceKey, InstanceFieldSpec>;

/**
 * Validate one value for a field, in stored units (the span window in ms). Returns the parsed
 * value, or the error message. Numbers may come as strings; an empty string or null means
 * "reset" and is handled by the caller.
 */
export function parseInstanceValue<K extends InstanceKey>(key: K, raw: unknown): { ok: true; value: NonNullable<InstanceValues[K]> } | { ok: false; message: string } {
  const spec = INSTANCE_FIELD[key];
  let v = raw;
  if ((spec.kind === 'int' || spec.kind === 'number') && typeof v === 'string') v = Number(v.trim());
  const r = (instanceValueSchemas[key] as z.ZodType).safeParse(v);
  if (r.success) return { ok: true, value: r.data as NonNullable<InstanceValues[K]> };
  return { ok: false, message: r.error.issues[0]?.message ?? 'Invalid value' };
}

// ---------------------------------------------------------------- API

export const adminInstanceSettingsSchema = z.object({
  /** effective value of every field; the API key shows as `...abcd` or null */
  values: z.record(z.string(), z.unknown()),
  /** the environment variable that sets the field, or null when the admin may change it */
  locked: z.record(z.string(), z.string().nullable()),
  /** fields with a value stored by an admin */
  stored: z.record(z.string(), z.boolean()),
  defaults: z.record(z.string(), z.unknown()),
  /** the provider, set by environment only (D-194): shown read-only with its redirect URI */
  oidc: z.object({
    configured: z.boolean(),
    issuer: z.string().nullable(),
    discoveryUrl: z.string().nullable(),
    providerId: z.string(),
    redirectUri: z.string(),
  }),
  /** D-194 bootstrap rule: on a public URL with no allowed domains only ADMIN_EMAILS get in until an admin exists */
  bootstrap: z.object({ publicUrl: z.boolean(), adminEmails: z.boolean(), openSignIn: z.boolean() }),
});
export type AdminInstanceSettings = z.infer<typeof adminInstanceSettingsSchema>;

/** A partial update: a value sets the field, null resets it to the default. */
export const updateInstanceSettingsBodySchema = z.record(z.string(), z.unknown());

export const testInstanceSettingBodySchema = z.object({
  target: z.enum(['transcription', 'oidc']),
  /** unsaved form values to test with; missing fields use the effective ones (the stored key included) */
  values: z.record(z.string(), z.unknown()).optional(),
});
export const testInstanceSettingResponseSchema = z.object({ ok: z.boolean(), message: z.string() });
export type TestInstanceSettingResult = z.infer<typeof testInstanceSettingResponseSchema>;

export const getInstanceSettings = defineRoute({
  name: 'instanceSettings.get',
  method: 'GET',
  path: api('/admin/settings'),
  auth: 'session',
  response: adminInstanceSettingsSchema,
  errors: ['forbidden'],
  area: 'server-core',
  tasks: ['D-194'],
  summary: 'Instance admins: effective server settings, which ones the environment locks, and the defaults.',
});

export const updateInstanceSettings = defineRoute({
  name: 'instanceSettings.update',
  method: 'PATCH',
  path: api('/admin/settings'),
  auth: 'session',
  body: updateInstanceSettingsBodySchema,
  response: adminInstanceSettingsSchema,
  errors: ['forbidden', 'locked_by_env', 'invalid_body'],
  area: 'server-core',
  tasks: ['D-194'],
  summary: 'Instance admins: change server settings; null resets a field. Takes effect without a restart.',
});

export const testInstanceSetting = defineRoute({
  name: 'instanceSettings.test',
  method: 'POST',
  path: api('/admin/settings/test'),
  auth: 'session',
  body: testInstanceSettingBodySchema,
  response: testInstanceSettingResponseSchema,
  errors: ['forbidden'],
  area: 'server-core',
  tasks: ['D-194'],
  summary: 'Instance admins: try the transcription provider or the OIDC discovery document.',
});

export const instanceSettingsRoutes = [getInstanceSettings, updateInstanceSettings, testInstanceSetting] as const;
