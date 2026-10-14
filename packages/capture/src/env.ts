// Page and device metadata (J-070, J-022): browser and version, OS, viewport (the emulated one
// under DevTools device mode), screen, DPR, locale, time zone, connection speed and latency,
// battery, cores, memory, and the country of the time zone (the server may replace it from the
// request IP at create).
import type { EnvInfo, MaskingPreset } from '@toolbar/shared';
import { countryForTimeZone } from './tz-country.ts';

interface UAData {
  brands?: { brand: string; version: string }[];
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?(hints: string[]): Promise<{ platformVersion?: string; fullVersionList?: { brand: string; version: string }[] }>;
}

export function parseUserAgent(ua: string): { browser: { name: string; version: string }; os: { name: string; version?: string } } {
  const pick = (re: RegExp) => re.exec(ua)?.[1];
  let browser = { name: 'Unknown', version: '' };
  const edg = pick(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  const opr = pick(/OPR\/([\d.]+)/);
  const ff = pick(/Firefox\/([\d.]+)/);
  const chr = pick(/(?:Chrome|CriOS|HeadlessChrome)\/([\d.]+)/);
  const saf = pick(/Version\/([\d.]+).*Safari/);
  if (edg) browser = { name: 'Edge', version: edg };
  else if (opr) browser = { name: 'Opera', version: opr };
  else if (ff) browser = { name: 'Firefox', version: ff };
  else if (chr) browser = { name: /HeadlessChrome/.test(ua) ? 'Chrome Headless' : 'Chrome', version: chr };
  else if (saf) browser = { name: 'Safari', version: saf };

  let os: { name: string; version?: string } = { name: 'Unknown' };
  const win = pick(/Windows NT ([\d.]+)/);
  const mac = pick(/Mac OS X ([\d_.]+)/);
  const android = pick(/Android ([\d.]+)/);
  const ios = pick(/(?:iPhone|iPad|iPod).* OS ([\d_]+)/);
  if (android) os = { name: 'Android', version: android };
  else if (ios) os = { name: 'iOS', version: ios.replace(/_/g, '.') };
  else if (win) os = { name: 'Windows', version: win === '10.0' ? '10/11' : win };
  else if (mac) os = { name: 'macOS', version: mac.replace(/_/g, '.') };
  else if (/CrOS/.test(ua)) os = { name: 'ChromeOS' };
  else if (/Linux/.test(ua)) os = { name: 'Linux' };
  return { browser, os };
}

/** Collects EnvInfo in a page. Async parts (battery, high-entropy UA) are bounded by `waitMs`. */
export async function collectEnv(win: Window & typeof globalThis = window, opts: { maskingPreset?: MaskingPreset; waitMs?: number } = {}): Promise<EnvInfo> {
  const nav = win.navigator as Navigator & { userAgentData?: UAData; connection?: { effectiveType?: string; downlink?: number; rtt?: number }; deviceMemory?: number; brave?: unknown };
  const { browser, os } = parseUserAgent(nav.userAgent);
  const env: EnvInfo = {
    ua: nav.userAgent,
    platform: nav.userAgentData?.platform || nav.platform || undefined,
    browser,
    os,
    viewport: { w: win.innerWidth, h: win.innerHeight },
    screen: { w: win.screen?.width ?? 0, h: win.screen?.height ?? 0 },
    dpr: win.devicePixelRatio || 1,
    locale: nav.language,
    tz: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    url: win.location.href,
    title: win.document.title || undefined,
    cores: nav.hardwareConcurrency || undefined,
    memory: nav.deviceMemory,
    touch: (nav.maxTouchPoints ?? 0) > 0,
    source: 'page',
  };
  const country = countryForTimeZone(env.tz);
  if (country) {
    env.country = country;
    env.countrySource = 'tz';
  }
  if (opts.maskingPreset) env.maskingPreset = opts.maskingPreset;
  if (nav.brave) env.browser = { name: 'Brave', version: browser.version };
  if (nav.connection) {
    const c = nav.connection;
    env.connection = { effectiveType: c.effectiveType, downlink: c.downlink, rtt: c.rtt };
  }
  const wait = <T,>(p: Promise<T>) => Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), opts.waitMs ?? 300))]);
  const tasks: Promise<unknown>[] = [];
  const getBattery = (nav as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery;
  if (typeof getBattery === 'function')
    tasks.push(
      wait(getBattery.call(nav))
        .then((b) => {
          if (b) env.battery = { level: Math.round(b.level * 100) / 100, charging: b.charging };
        })
        .catch(() => {}),
    );
  if (nav.userAgentData?.getHighEntropyValues)
    tasks.push(
      wait(nav.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList']))
        .then((h) => {
          if (!h) return;
          const full = h.fullVersionList?.find((b) => b.brand === (browser.name === 'Edge' ? 'Microsoft Edge' : browser.name === 'Chrome' ? 'Google Chrome' : browser.name)) ?? h.fullVersionList?.find((b) => b.brand === 'Chromium');
          if (full && env.browser) env.browser = { ...env.browser, version: full.version };
          if (h.platformVersion && env.os) {
            if (env.os.name === 'Windows') env.os = { name: 'Windows', version: Number(h.platformVersion.split('.')[0]) >= 13 ? '11' : '10' };
            else env.os = { ...env.os, version: h.platformVersion };
          }
        })
        .catch(() => {}),
    );
  await Promise.all(tasks);
  return env;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
