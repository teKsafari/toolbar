import { describe, expect, it } from 'vitest';
import { countryForTimeZone } from '../src/tz-country.ts';

describe('countryForTimeZone (J-070)', () => {
  it('maps canonical zones', () => {
    expect(countryForTimeZone('America/New_York')).toBe('US');
    expect(countryForTimeZone('Africa/Dar_es_Salaam')).toBe('TZ');
    expect(countryForTimeZone('Europe/Berlin')).toBe('DE');
    expect(countryForTimeZone('Asia/Kolkata')).toBe('IN');
  });
  it('resolves aliases through their link target', () => {
    expect(countryForTimeZone('Asia/Calcutta')).toBe('IN');
    expect(countryForTimeZone('US/Eastern')).toBe('US');
  });
  it('keeps zones zone.tab gives their own country', () => {
    expect(countryForTimeZone('Europe/Vaduz')).toBe('LI');
  });
  it('gives no country for UTC or unknown names', () => {
    expect(countryForTimeZone('UTC')).toBeUndefined();
    expect(countryForTimeZone('Etc/GMT+3')).toBeUndefined();
    expect(countryForTimeZone(undefined)).toBeUndefined();
    expect(countryForTimeZone('Mars/Olympus')).toBeUndefined();
  });
});
