// Shared types and constants the ext-ui area adds (import from '@toolbar/shared/areas/ext-ui').
// Only the ext-ui area edits this file. Pure helpers only: the popup, the in-page UI and the
// service worker all import it, and the capture area uses isReplayBlocked() for the ring.

/** Screenshot delay choices on the screenshot row's chevron (J-005). 0 means off. */
export const SCREENSHOT_DELAYS = [0, 3, 6] as const;
export type ScreenshotDelay = (typeof SCREENSHOT_DELAYS)[number];

/** Pointer travel in CSS px before a press in screenshot mode counts as a drag (J-003). */
export const DRAG_THRESHOLD_PX = 4;

/** Cursor hint offset from the pointer (J-025). */
export const CURSOR_PILL_OFFSET = { x: 5, y: 20 } as const;

/** Pre-roll countdown length in seconds (J-027). */
export const COUNTDOWN_FROM = 3;

/** Live pen strokes fade after this many ms (J-030). */
export const LIVE_STROKE_FADE_MS = 2500;

/** Twelve live-pen colours, red first and preselected (J-030). Our own hues. */
export const LIVE_PEN_COLORS = [
  '#e0402f',
  '#f2742b',
  '#f2b100',
  '#9bc53d',
  '#239a64',
  '#16a3a3',
  '#1d93d0',
  '#3446cf',
  '#7a4fd6',
  '#d64fa9',
  '#ffffff',
  '#1a1918',
] as const;

/** Dwell before a popup row shows its shortcut tooltip (J-212). */
export const SHORTCUT_TOOLTIP_DELAY_MS = 2000;

/** Recording cap stages: the timer turns orange, then red, before the cap (J-013). */
export const CAP_WARN_MS = 30_000;
export const CAP_DANGER_MS = 10_000;

export type CapStage = 'none' | 'normal' | 'warn' | 'danger';

export function capStage(elapsedMs: number, capMs: number | null): CapStage {
  if (!capMs) return 'none';
  const left = capMs - elapsedMs;
  if (left <= CAP_DANGER_MS) return 'danger';
  if (left <= CAP_WARN_MS) return 'warn';
  return 'normal';
}

/** m:ss, or h:mm:ss past an hour. Negative input counts as 0. */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Short relative age for the Drafts list: "just now", "5 min ago", "3 h ago", "2 d ago". */
export function relativeAge(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/**
 * Pages where the extension cannot run: browser-internal schemes, other extensions, the
 * extension stores and PDF viewer pages (J-199). The popup shows its restricted state there
 * and the commands do nothing.
 */
const RESTRICTED_SCHEMES = ['chrome:', 'chrome-extension:', 'chrome-untrusted:', 'chrome-search:', 'edge:', 'about:', 'view-source:', 'devtools:', 'brave:', 'opera:', 'vivaldi:', 'moz-extension:', 'data:', 'blob:', 'javascript:'];
const RESTRICTED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com', 'microsoftedge.microsoft.com'];

export function isRestrictedUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (RESTRICTED_SCHEMES.includes(u.protocol)) return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return true;
  if (u.hostname === 'chrome.google.com' && !u.pathname.startsWith('/webstore')) return false;
  return RESTRICTED_HOSTS.includes(u.hostname);
}

/** Normalise user input for a site list: "https://www.Bank.com/x" -> "bank.com". Null when invalid. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^([a-z0-9-]+\.)+[a-z0-9-]{2,}$/.test(host) && host !== 'localhost') return null;
  return host;
}

/** True when `host` is `domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Instant replay keeps no ring on blocked sites (J-012). */
export function isReplayBlocked(url: string, blocked: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return blocked.some((d) => hostMatches(host, d));
}

/**
 * Sites where instant replay is off by default (J-012): payment, banking, brokerage, crypto and
 * password-manager sites, where a rolling DOM record has nothing to gain and much to leak.
 * Our own selection; users add and remove entries in popup settings.
 */
export const DEFAULT_REPLAY_BLOCKED_SITES: readonly string[] = [
  // payments and wallets
  'paypal.com', 'stripe.com', 'squareup.com', 'wise.com', 'revolut.com', 'venmo.com', 'cash.app', 'klarna.com',
  'adyen.com', 'braintreegateway.com', 'checkout.com', 'payoneer.com', 'skrill.com', 'zelle.com', 'mpesa.com',
  // banks
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'capitalone.com', 'usbank.com', 'pnc.com',
  'hsbc.com', 'barclays.co.uk', 'lloydsbank.com', 'natwest.com', 'santander.com', 'bnpparibas.com', 'deutsche-bank.de',
  'ing.com', 'rabobank.nl', 'commbank.com.au', 'westpac.com.au', 'rbc.com', 'td.com', 'scotiabank.com',
  'equitybank.co.ke', 'kcbgroup.com', 'standardbank.co.za', 'absa.co.za', 'monzo.com', 'n26.com', 'chime.com',
  'americanexpress.com', 'discover.com',
  // brokers and investing
  'fidelity.com', 'schwab.com', 'vanguard.com', 'etrade.com', 'robinhood.com', 'interactivebrokers.com',
  'tdameritrade.com', 'merrilledge.com', 'trading212.com', 'degiro.com', 'wealthfront.com', 'betterment.com',
  // crypto
  'coinbase.com', 'binance.com', 'kraken.com', 'crypto.com', 'gemini.com', 'bitstamp.net', 'kucoin.com',
  'okx.com', 'bybit.com', 'metamask.io', 'blockchain.com', 'ledger.com', 'bitpanda.com',
  // password managers and identity
  '1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'keepersecurity.com', 'proton.me',
  'login.gov', 'id.me',
  // tax and payroll
  'irs.gov', 'turbotax.intuit.com', 'hrblock.com', 'gusto.com', 'adp.com',
];

/** Help links in the popup menu (J-177, J-170): our docs, source and issue tracker. */
export const HELP_LINKS = {
  docs: 'https://github.com/Heracraft/toolbar#readme',
  source: 'https://github.com/Heracraft/toolbar',
  issues: 'https://github.com/Heracraft/toolbar/issues/new',
} as const;

/** Chrome's shortcut editor (J-184). */
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/** Format a Chrome command shortcut for display: "Ctrl+Shift+S" stays, "" becomes null. */
export function chordLabel(shortcut: string | undefined | null): string | null {
  if (!shortcut) return null;
  return shortcut.replace(/⌘/g, 'Cmd+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+').replace(/\+\+/g, '+');
}

/** Clamp a dragged bar so it stays fully inside the viewport (J-238). */
export function clampToViewport(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(margin, pos.x), Math.max(margin, viewport.w - size.w - margin)),
    y: Math.min(Math.max(margin, pos.y), Math.max(margin, viewport.h - size.h - margin)),
  };
}

/** Normalised rectangle from two pointer points, clamped to the viewport (J-003). */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  viewport: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const x1 = Math.max(0, Math.min(a.x, b.x));
  const y1 = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.min(viewport.w, Math.max(a.x, b.x));
  const y2 = Math.min(viewport.h, Math.max(a.y, b.y));
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(Math.max(0, x2 - x1)), h: Math.round(Math.max(0, y2 - y1)) };
}
