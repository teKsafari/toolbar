// Screenshot access per tab (D-185): Chrome's activeTab refusal is told apart from the quota
// error, remembered per tab, and probed again while blocked.
import { describe, expect, it } from 'vitest';
import { forgetShotTab, isShotBlocked, noteShotError, probeShots, shotAccess } from '../lib/bg/shot-access';

const refusal = new Error("Either the '<all_urls>' or 'activeTab' permission is required.");
const quota = new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');

describe('shot access', () => {
  it('tells the activeTab refusal from the quota error', () => {
    expect(isShotBlocked(refusal)).toBe(true);
    expect(isShotBlocked(quota)).toBe(false);
    expect(noteShotError(7, quota)).toBe(false);
    expect(shotAccess(7)).toBe('unknown');
    expect(noteShotError(7, refusal)).toBe(true);
    expect(shotAccess(7)).toBe('blocked');
    forgetShotTab(7);
    expect(shotAccess(7)).toBe('unknown');
  });

  it('probes once when unknown, waits while blocked, and flips to ok after the menu was opened', async () => {
    let allowed = false;
    let calls = 0;
    const capture = async () => {
      calls++;
      if (!allowed) throw refusal;
      return 'data:image/jpeg;base64,';
    };
    expect(await probeShots(9, capture, { now: 1000 })).toBe('blocked');
    expect(await probeShots(9, capture, { now: 3000 })).toBe('blocked');
    expect(calls).toBe(1); // within 5 s of the last try, no new capture
    allowed = true; // the reviewer opened the popup on the tab
    expect(await probeShots(9, capture, { now: 7000 })).toBe('ok');
    expect(await probeShots(9, capture, { now: 9000 })).toBe('ok');
    expect(calls).toBe(2);
    // a quota error leaves the state alone
    expect(await probeShots(10, async () => Promise.reject(quota), { now: 1000 })).toBe('unknown');
  });
});
