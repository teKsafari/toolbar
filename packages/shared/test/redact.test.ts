import { describe, expect, it } from 'vitest';
import { MASKED_TYPING, REDACTED, isMaskedField, luhn, redactBody, redactEvent, redactHeaders, redactUrl, scrubText, typedValue } from '../src/redact.ts';
import { createEmitter } from '../src/events.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('redaction', () => {
  it('masks secret headers and lists them (J-185)', () => {
    const r = redactHeaders({ Authorization: 'Bearer x', Cookie: 'a=b', 'content-type': 'application/json', 'X-Api-Key': 'k', 'x-csrf-token': 't' });
    expect(r.headers).toEqual({ Authorization: REDACTED, Cookie: REDACTED, 'content-type': 'application/json', 'X-Api-Key': REDACTED, 'x-csrf-token': REDACTED });
    expect(r.redacted.sort()).toEqual(['authorization', 'cookie', 'x-api-key', 'x-csrf-token']);
  });

  it('replaces secret JSON fields and scrubs JWTs, emails and Luhn-valid cards (J-186)', () => {
    const body = JSON.stringify({ name: 'Ada', email: 'ada@example.com', password: 'hunter2', notes: `token ${JWT} card 4242 4242 4242 4242 not 1234 5678 9012 3456`, nested: { apiKey: 'abc', author: 'Ada' } });
    const out = JSON.parse(redactBody(body, 'application/json')!);
    expect(out).toEqual({ name: 'Ada', email: REDACTED, password: REDACTED, notes: `token ${REDACTED} card ${REDACTED} not 1234 5678 9012 3456`, nested: { apiKey: REDACTED, author: 'Ada' } });
  });

  it('handles form, multipart and plain text bodies', () => {
    expect(redactBody('name=Ada&email=ada%40x.io&password=pw', 'application/x-www-form-urlencoded')).toBe(`name=Ada&email=${encodeURIComponent(REDACTED)}&password=${encodeURIComponent(REDACTED)}`);
    const mp = '--b\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter2\r\n--b\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n--b--';
    const out = redactBody(mp, 'multipart/form-data; boundary=b')!;
    expect(out).toContain(REDACTED);
    expect(out).not.toContain('hunter2');
    expect(out).toContain('Ada');
    expect(redactBody(`hello ${JWT}`, 'text/plain')).toBe(`hello ${REDACTED}`);
  });

  it('blanks secret query parameters', () => {
    expect(redactUrl('https://x.io/a?token=abc&q=1#h')).toBe(`https://x.io/a?token=${encodeURIComponent(REDACTED)}&q=1#h`);
  });

  it('masks typing in email and password fields only (J-187)', () => {
    expect(isMaskedField({ tag: 'input', type: 'password' })).toBe(true);
    expect(isMaskedField({ tag: 'input', type: 'email' })).toBe(true);
    expect(isMaskedField({ tag: 'input', type: 'text', name: 'name' })).toBe(false);
    expect(typedValue('secret', { tag: 'input', type: 'password' })).toEqual({ value: MASKED_TYPING, masked: true });
    expect(typedValue('a', { tag: 'input', type: 'email' }).value).toBe(MASKED_TYPING);
    expect(typedValue('Ada', { tag: 'input', type: 'text' })).toEqual({ value: 'Ada', masked: false });
    expect(typedValue('x', { tag: 'input', type: 'text' }, 'production').masked).toBe(true);
  });

  it('checks Luhn and scrubs content', () => {
    expect(luhn('4242424242424242')).toBe(true);
    expect(luhn('4242424242424241')).toBe(false);
    expect(scrubText('mail ada@x.io', { emails: true })).toBe(`mail ${REDACTED}`);
    expect(scrubText('mail ada@x.io')).toBe('mail ada@x.io');
  });

  it('redacts network events', () => {
    const make = createEmitter('top');
    const req = redactEvent(make('net.req', { rid: '1', method: 'POST', url: 'http://x/api?api_key=1', headers: { authorization: 'b', 'content-type': 'application/json' }, body: '{"password":"p"}', source: 'page' }));
    expect(req.kind === 'net.req' && req.data).toMatchObject({ url: `http://x/api?api_key=${encodeURIComponent(REDACTED)}`, headers: { authorization: REDACTED }, body: `{"password":"${REDACTED}"}` });
    const res = redactEvent(make('net.res', { rid: '1', status: 200, headers: { 'set-cookie': 's' }, body: `{"token":"${JWT}"}`, contentType: 'application/json' }));
    expect(res.kind === 'net.res' && res.data).toMatchObject({ headers: { 'set-cookie': REDACTED }, body: `{"token":"${REDACTED}"}` });
  });
});
