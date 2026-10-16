// Test buttons of Settings > Server (D-187): try the transcription provider and the OIDC discovery
// document with the values on the form, before or after saving. Each probe makes one or two
// requests with a short timeout and answers a sentence the page shows as is.
import type { TestInstanceSettingResult } from '@toolbar/shared/api';
import { parseInstanceValue, type InstanceKey } from '@toolbar/shared/api';
import { env } from '../env.ts';
import { setting } from './index.ts';

const TIMEOUT_MS = 8000;

/** A form value when it parses, else the effective setting (the stored API key when the form leaves it blank). */
function pick<K extends InstanceKey>(values: Record<string, unknown>, key: K) {
  const v = values[key];
  if (v !== undefined && v !== null && v !== '') {
    const r = parseInstanceValue(key, v);
    if (r.ok) return r.value;
  }
  return setting(key);
}

const why = (e: unknown) => {
  const err = e as Error & { cause?: { code?: string } };
  if (err.name === 'TimeoutError') return `no answer within ${TIMEOUT_MS / 1000} s`;
  return err.cause?.code ?? err.message;
};

export async function probeTranscription(values: Record<string, unknown> = {}, f: typeof fetch = fetch): Promise<TestInstanceSettingResult> {
  const provider = pick(values, 'transcribeProvider');
  if (provider === 'none' || !provider) return { ok: false, message: 'Transcription is off. Pick a provider first.' };
  if (provider === 'local') {
    const url = pick(values, 'whisperUrl') ?? 'http://localhost:8080';
    try {
      const r = await f(`${url}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.ok) return { ok: true, message: `whisper.cpp answered at ${url}.` };
      return { ok: false, message: `whisper.cpp at ${url} answered HTTP ${r.status}. It answers once its model has downloaded.` };
    } catch (e) {
      return { ok: false, message: `Could not reach whisper.cpp at ${url} (${why(e)}). Start it with docker-compose.whisper.yml.` };
    }
  }
  const base = pick(values, 'transcribeBaseUrl') ?? 'https://api.openai.com/v1';
  const key = pick(values, 'transcribeApiKey') ?? '';
  const model = pick(values, 'transcribeModel') ?? 'gpt-transcribe';
  if (!key && /\/\/api\.openai\.com\b/.test(base)) return { ok: false, message: 'api.openai.com needs an API key.' };
  try {
    const r = await f(`${base}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 401 || r.status === 403) return { ok: false, message: `${base} refused the key (HTTP ${r.status}).` };
    if (r.status === 404) return { ok: true, message: `${base} answered, but has no /models list to check the model against.` };
    if (!r.ok) return { ok: false, message: `${base}/models answered HTTP ${r.status}.` };
    const body = (await r.json().catch(() => null)) as { data?: { id?: string }[] } | null;
    const ids = (body?.data ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length && !ids.includes(model)) return { ok: false, message: `${base} accepted the key, but lists no model ${model}.` };
    return { ok: true, message: `${base} accepted the key${ids.length ? ` and offers ${model}` : ''}.` };
  } catch (e) {
    return { ok: false, message: `Could not reach ${base} (${why(e)}).` };
  }
}

export async function probeOidc(values: Record<string, unknown> = {}, f: typeof fetch = fetch): Promise<TestInstanceSettingResult> {
  const o = env.auth.oidc;
  if (!o) return { ok: false, message: 'No provider: set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET on the server.' };
  const url = o.discoveryUrl;
  let doc: Record<string, unknown>;
  try {
    const r = await f(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return { ok: false, message: `${url} answered HTTP ${r.status}.` };
    doc = (await r.json()) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, message: `Could not read ${url} (${why(e)}).` };
  }
  const missing = ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'].filter((k) => typeof doc[k] !== 'string');
  if (missing.length) return { ok: false, message: `${url} is not a discovery document: it lacks ${missing.join(', ')}.` };
  const scopes = pick(values, 'oidcScopes') ?? [];
  const supported = Array.isArray(doc.scopes_supported) ? (doc.scopes_supported as string[]) : null;
  const unknown = supported ? scopes.filter((s) => !supported.includes(s)) : [];
  if (unknown.length) return { ok: false, message: `The provider (${doc.issuer}) does not list the scopes ${unknown.join(', ')}.` };
  return { ok: true, message: `Found the provider ${doc.issuer}.` };
}
