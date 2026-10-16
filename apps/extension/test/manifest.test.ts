import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANAGED_SCHEMA, MANIFEST_KEY, buildName, hostPermissions } from '../wxt.config';
import { CAPTURE_SCRIPTS } from '../lib/registration';

/** Chrome derives the id from sha256 of the DER public key, first 32 hex digits mapped 0-f to a-p. */
function extensionId(keyB64: string) {
  const hex = createHash('sha256').update(Buffer.from(keyB64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

describe('manifest', () => {
  it('pins the documented extension id', () => {
    expect(extensionId(MANIFEST_KEY)).toBe('laobpjhffglefallhhojihfdbdkoendk');
  });

  it('registers one MAIN and one ISOLATED capture script', () => {
    expect(CAPTURE_SCRIPTS.map((s) => s.world).sort()).toEqual(['ISOLATED', 'MAIN']);
  });

  it('takes the build name from WXT_APP_NAME, default open-toolbar (D-112)', () => {
    expect(buildName(undefined)).toBe('open-toolbar');
    expect(buildName('  ')).toBe('open-toolbar');
    expect(buildName('Acme Review')).toBe('Acme Review');
    expect(() => buildName('<b>')).toThrow();
    expect(() => buildName('x'.repeat(61))).toThrow();
  });

  it('holds every site as a required host permission, the server listed too (D-202)', () => {
    expect(hostPermissions(false, 'https://toolbar.teksafari.com')).toEqual(['https://toolbar.teksafari.com/*', '<all_urls>']);
    expect(hostPermissions(true, 'https://toolbar.teksafari.com')).toEqual(['<all_urls>']);
  });

  it('ships a managed storage schema with serverUrl and lockServerUrl (D-202)', () => {
    const schema = JSON.parse(readFileSync(new URL(`../public/${MANAGED_SCHEMA}`, import.meta.url), 'utf8')) as { type: string; properties: Record<string, { type: string }> };
    expect(schema.type).toBe('object');
    expect(Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, v.type]))).toEqual({ serverUrl: 'string', lockServerUrl: 'boolean' });
  });
});
