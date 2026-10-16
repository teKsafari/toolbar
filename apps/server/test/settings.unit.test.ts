// Instance settings (D-194) without a database: precedence (environment > stored > default), the
// lenient parsing of the old variables, validation and locks of an update, the masked API key,
// and the two test probes against recorded answers.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTANCE_FIELDS, INSTANCE_KEYS, parseInstanceValue } from '@toolbar/shared/api';
import { _setStoredForTest, adminView, allowedDomains, applyPatch, defaultOf, envOverride, setting, SettingsError } from '../src/lib/server/settings/index.ts';
import { probeOidc, probeTranscription } from '../src/lib/server/settings/probe.ts';
import { transcribeConfig } from '../src/lib/server/transcribe/config.ts';
import { env } from '../src/lib/server/env.ts';

const saved = { ...process.env };
const ALL_ENV = INSTANCE_FIELDS.flatMap((f) => f.env);
beforeEach(() => {
  for (const n of ALL_ENV) delete process.env[n];
  env.auth.allowedDomains.length = 0;
  _setStoredForTest({});
});
afterEach(() => {
  process.env = { ...saved };
  env.auth.allowedDomains.length = 0;
  _setStoredForTest({});
});

describe('precedence: environment, else stored, else default', () => {
  it('uses the default when nothing is set', () => {
    expect(setting('shareLinkDays')).toBe(14);
    expect(setting('transcribeProvider')).toBe('none');
    expect(setting('oidcScopes')).toEqual(['openid', 'email', 'profile']);
    expect(setting('defaultTraceOpenMs')).toBe(10_000);
    expect(setting('recordingLinkRateLimit')).toBe(10);
    expect(setting('maxRecordingMin')).toBeNull();
  });

  it('a stored value beats the default, and a set variable beats both and locks the field', () => {
    _setStoredForTest({ shareLinkDays: 30, transcribeProvider: 'openai', allowedEmailDomains: ['acme.test'] });
    expect(setting('shareLinkDays')).toBe(30);
    expect(transcribeConfig().provider).toBe('openai');
    expect(allowedDomains()).toEqual(['acme.test']);
    expect(envOverride('shareLinkDays')).toBeNull();

    process.env.SHARE_LINK_DAYS = '7';
    process.env.TRANSCRIBE_PROVIDER = 'none';
    env.auth.allowedDomains.push('env.test');
    expect(setting('shareLinkDays')).toBe(7);
    expect(transcribeConfig().provider).toBe('none');
    expect(allowedDomains()).toEqual(['env.test']);
    expect(envOverride('shareLinkDays')?.name).toBe('SHARE_LINK_DAYS');
    const v = adminView();
    expect(v.locked.shareLinkDays).toBe('SHARE_LINK_DAYS');
    expect(v.locked.transcribeProvider).toBe('TRANSCRIBE_PROVIDER');
    expect(v.locked.allowedEmailDomains).toBe('ALLOWED_EMAIL_DOMAINS');
    expect(v.stored.shareLinkDays).toBe(true);
    expect(v.values.shareLinkDays).toBe(7);
  });

  it('an empty variable counts as unset', () => {
    _setStoredForTest({ exportMaxMb: 50 });
    process.env.EXPORT_MAX_MB = '  ';
    expect(setting('exportMaxMb')).toBe(50);
    expect(adminView().locked.exportMaxMb).toBeNull();
  });

  it('reads the old variables as before: clamps, aliases and STT_URL without /v1', () => {
    Object.assign(process.env, { TRANSCRIBE_CONCURRENCY: '99', TRANSCRIBE_CHUNK_SECONDS: '1', TRANSCRIBE_PROVIDER: 'openai-compatible', STT_URL: 'http://speaches:8000/', OIDC_SCOPES: 'openid,email groups' });
    expect(setting('transcribeConcurrency')).toBe(16);
    expect(setting('transcribeChunkSeconds')).toBe(5);
    expect(setting('transcribeProvider')).toBe('openai');
    expect(setting('transcribeBaseUrl')).toBe('http://speaches:8000/v1');
    expect(setting('oidcScopes')).toEqual(['openid', 'email', 'groups']);
    process.env.SHARE_LINK_DAYS = 'soon';
    expect(envOverride('shareLinkDays')).toBeNull(); // not a number: ignored with a warning
    expect(setting('shareLinkDays')).toBe(14);
  });

  it('has a default for every field', () => {
    for (const k of INSTANCE_KEYS) expect(() => defaultOf(k), k).not.toThrow();
    expect(INSTANCE_FIELDS.map((f) => f.key).sort()).toEqual([...INSTANCE_KEYS].sort());
  });
});

describe('updates', () => {
  it('validates each field and names it in the error', () => {
    expect(applyPatch({}, { allowedEmailDomains: '@Acme.test, eu.acme.test' })).toEqual({ allowedEmailDomains: ['acme.test', 'eu.acme.test'] });
    expect(() => applyPatch({}, { allowedEmailDomains: 'not a domain!' })).toThrow(/Allowed email domains: Use domains such as example.com/);
    expect(() => applyPatch({}, { oidcScopes: 'openid profile' })).toThrow(/Keep openid and email/);
    expect(() => applyPatch({}, { shareLinkDays: -1 })).toThrow(SettingsError);
    expect(() => applyPatch({}, { transcribeProvider: 'magic' })).toThrow(/Provider/);
    expect(() => applyPatch({}, { defaultTraceOpenMs: 1000 })).toThrow(/At least 3 s/);
    expect(() => applyPatch({}, { supportRecordingLink: 'ftp://x' })).toThrow(/http\(s\) URL, or off/);
    expect(() => applyPatch({}, { nonsense: 1 })).toThrow(/Unknown setting/);
    expect(applyPatch({}, { shareLinkDays: '30', supportRecordingLink: 'off', transcribeBaseUrl: 'https://api.groq.com/openai/v1/' })).toEqual({
      shareLinkDays: 30,
      supportRecordingLink: 'off',
      transcribeBaseUrl: 'https://api.groq.com/openai/v1',
    });
  });

  it('null or an empty string resets a field to its default', () => {
    expect(applyPatch({ shareLinkDays: 30, exportMaxMb: 5 }, { shareLinkDays: null, exportMaxMb: '' })).toEqual({});
  });

  it('refuses to change a field the environment sets', () => {
    process.env.TRANSCRIBE_API_KEY = 'sk-env';
    try {
      applyPatch({}, { transcribeApiKey: 'sk-mine' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SettingsError);
      expect((e as SettingsError).code).toBe('locked_by_env');
      expect((e as SettingsError).message).toBe('API key is set by TRANSCRIBE_API_KEY on the server.');
    }
  });

  it('never hands the API key back in full', () => {
    _setStoredForTest({ transcribeApiKey: 'sk-proj-abcdefghijklmnop1234' });
    const v = adminView();
    expect(v.values.transcribeApiKey).toBe('...1234');
    expect(JSON.stringify(v)).not.toContain('abcdefghijklmnop');
    expect(transcribeConfig().apiKey).toBe('sk-proj-abcdefghijklmnop1234');
    _setStoredForTest({ transcribeApiKey: 'short' });
    expect(adminView().values.transcribeApiKey).toBe('...');
  });

  it('the shared parser accepts form strings for numbers', () => {
    expect(parseInstanceValue('transcribeMonthlyMinutes', '6000')).toEqual({ ok: true, value: 6000 });
    expect(parseInstanceValue('transcribeMaxMinutes', 'abc')).toMatchObject({ ok: false });
  });
});

const answer = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('test probes', () => {
  it('transcription: off, a refused key, an accepted key, an unknown model, whisper down', async () => {
    expect((await probeTranscription({})).ok).toBe(false);
    expect((await probeTranscription({ transcribeProvider: 'openai' })).message).toBe('api.openai.com needs an API key.');
    let seen: Request | null = null;
    const ok = await probeTranscription({ transcribeProvider: 'openai', transcribeApiKey: 'sk-1' }, (async (u: string, init: RequestInit) => {
      seen = new Request(u, init);
      return answer(200, { data: [{ id: 'gpt-transcribe' }, { id: 'whisper-1' }] })();
    }) as typeof fetch);
    expect(ok).toEqual({ ok: true, message: 'https://api.openai.com/v1 accepted the key and offers gpt-transcribe.' });
    expect(seen!.url).toBe('https://api.openai.com/v1/models');
    expect(seen!.headers.get('authorization')).toBe('Bearer sk-1');
    expect(await probeTranscription({ transcribeProvider: 'openai', transcribeApiKey: 'bad' }, answer(401) as typeof fetch)).toMatchObject({ ok: false, message: expect.stringContaining('refused the key') });
    expect(await probeTranscription({ transcribeProvider: 'openai', transcribeApiKey: 'k', transcribeModel: 'nope' }, answer(200, { data: [{ id: 'whisper-1' }] }) as typeof fetch)).toMatchObject({ ok: false });
    const down = await probeTranscription({ transcribeProvider: 'local', whisperUrl: 'http://whisper:8080' }, (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as typeof fetch);
    expect(down.message).toBe('Could not reach whisper.cpp at http://whisper:8080 (ECONNREFUSED). Start it with docker-compose.whisper.yml.');
  });

  it('transcription: the stored key is used when the form leaves it blank', async () => {
    _setStoredForTest({ transcribeProvider: 'openai', transcribeApiKey: 'sk-stored-000000' });
    let auth = '';
    await probeTranscription({ transcribeApiKey: '' }, (async (_u: string, init: RequestInit) => {
      auth = new Headers(init.headers).get('authorization') ?? '';
      return answer(404)();
    }) as typeof fetch);
    expect(auth).toBe('Bearer sk-stored-000000');
  });

  it('oidc: no provider, a discovery document, missing scopes', async () => {
    const before = env.auth.oidc;
    try {
      env.auth.oidc = null;
      expect((await probeOidc()).message).toMatch(/^No provider/);
      env.auth.oidc = { providerId: 'oidc', issuer: 'https://id.test', discoveryUrl: 'https://id.test/.well-known/openid-configuration', clientId: 'c', clientSecret: 's', scopes: [], name: 'SSO' };
      const doc = { issuer: 'https://id.test', authorization_endpoint: 'a', token_endpoint: 't', jwks_uri: 'j', scopes_supported: ['openid', 'email', 'profile'] };
      expect(await probeOidc({}, answer(200, doc) as typeof fetch)).toEqual({ ok: true, message: 'Found the provider https://id.test.' });
      expect((await probeOidc({ oidcScopes: 'openid email groups' }, answer(200, doc) as typeof fetch)).message).toBe('The provider (https://id.test) does not list the scopes groups.');
      expect((await probeOidc({}, answer(200, { issuer: 'x' }) as typeof fetch)).message).toMatch(/is not a discovery document/);
      expect((await probeOidc({}, answer(500) as typeof fetch)).ok).toBe(false);
    } finally {
      env.auth.oidc = before;
    }
  });
});
