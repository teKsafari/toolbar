import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MANIFEST_KEY, buildName } from '../wxt.config';
import { CAPTURE_SCRIPTS } from '../lib/registration';

/** Chrome derives the id from sha256 of the DER public key, first 32 hex digits mapped 0-f to a-p. */
function extensionId(keyB64: string) {
  const hex = createHash('sha256').update(Buffer.from(keyB64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

describe('manifest', () => {
  it('pins the documented extension id', () => {
    expect(extensionId(MANIFEST_KEY)).toBe('fmongfmimgdafigcahdpofnmmhljpnei');
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
});
