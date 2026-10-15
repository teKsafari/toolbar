// Dark-mode recheck for the parity rows whose claims rest on theme shots (J-090, J-099, J-118,
// J-121, J-124, J-173): each page state at 1440 and 390 in light and dark, pinned with the rig's
// pinTheme. Per state: sideways overflow, and the WCAG contrast of every visible text run against
// the background it sits on (the lowest ratios are listed). Plain Chromium, signed in as the
// parity account through the dev password; reads the capture ids the scenarios left behind.
//   cd e2e && node --experimental-strip-types parity/dark-probe.ts > runs/parity-rr1-dark-probe.json
import { chromium, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pinTheme, ROOT, SERVER, PASSWORD } from './rig.ts';

const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';
const shots = (g: string, f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e/parity-shots', g, f), 'utf8'));
const N1 = shots('G3', 'S3.1.json').capture.id as string;
const N4 = shots('G2', 'S2.1-23-recording.json').id as string;
const SHARE = new URL(shots('G5', 'S5.1.json')['step1-copy-link (J-117)'].clipboard as string).pathname;

type State = { name: string; rows: string[]; url: string; signedOut?: boolean; setup?: (p: Page, w: number) => Promise<void> };

async function devtools(p: Page) {
  if (await p.getByTestId('narrow-devtools').isVisible().catch(() => false)) await p.getByTestId('narrow-devtools').click();
}

const states: State[] = [
  { name: 'capture-page-N1', rows: ['J-090'], url: `/c/${N1}` },
  { name: 'network-N1', rows: ['J-058', 'J-105'], url: `/c/${N1}`, setup: async (p) => { await devtools(p); await p.getByTestId('tab-network').click(); } },
  { name: 'console-N1', rows: ['J-055', 'J-056'], url: `/c/${N1}`, setup: async (p) => { await devtools(p); await p.getByTestId('tab-console').click(); } },
  { name: 'lightbox-N4', rows: ['J-099'], url: `/c/${N4}`, setup: async (p) => { await p.getByRole('button', { name: 'Open the image large' }).click(); await p.getByTestId('lightbox').waitFor(); } },
  { name: 'share-popover-N1', rows: ['J-118'], url: `/c/${N1}`, setup: async (p) => { await p.getByTestId('share-caret').click(); } },
  { name: 'members', rows: ['J-124', 'J-173'], url: '/settings/members' },
  { name: 'signed-out-share', rows: ['J-121'], url: SHARE, signedOut: true },
  { name: 'signed-out-share-devtools', rows: ['J-121'], url: SHARE, signedOut: true, setup: async (p) => { await devtools(p); await p.getByTestId('tab-network').click(); } },
];

function contrastScan(p: Page) {
  return p.evaluate(() => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const L = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    const blend = (top: number[], under: number[]) => { const a = top[3] ?? 1; return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)); };
    const bgOf = (el: Element | null): number[] => {
      const stack: number[][] = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c.length && (c[3] ?? 1) > 0) { stack.push(c); if ((c[3] ?? 1) >= 1) break; }
      }
      let base = [255, 255, 255];
      const root = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (root.length && (root[3] ?? 1) > 0) base = root.slice(0, 3);
      if (stack.length && (stack[stack.length - 1]![3] ?? 1) >= 1) base = stack.pop()!.slice(0, 3);
      for (const c of stack.reverse()) base = blend(c, base);
      return base;
    };
    const out: { text: string; ratio: number; fg: string; size: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent ?? '').trim()) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (el.closest('[aria-hidden="true"], video, canvas')) continue;
      const fg = parse(cs.color);
      const bg = bgOf(el);
      const f = blend(fg, bg);
      const [a, b] = [L(f), L(bg)].sort((x, y) => y - x);
      out.push({ text: (n.textContent ?? '').trim().slice(0, 40), ratio: Math.round(((a! + 0.05) / (b! + 0.05)) * 100) / 100, fg: cs.color, size: parseFloat(cs.fontSize) });
    }
    out.sort((x, y) => x.ratio - y.ratio);
    return { texts: out.length, below45: out.filter((o) => o.ratio < 4.5).length, below3: out.filter((o) => o.ratio < 3).length, lowest: out.slice(0, 6) };
  });
}

const b = await chromium.launch();
// one sign-in for every state (the server allows 3 sign-ins per 10 s per address)
const login = await b.newContext();
const lr = await login.request.post(`${SERVER}/api/auth/sign-in/email`, { data: { email: EMAIL, password: PASSWORD }, headers: { origin: SERVER } });
if (!lr.ok()) throw new Error(`sign-in ${lr.status()}`);
const storageState = await login.storageState();
await login.close();
const result: Record<string, unknown> = { server: SERVER, N1, N4, share: SHARE, at: new Date().toISOString() };
for (const s of states)
  for (const [w, h] of [[1440, 900], [390, 844]] as const)
    for (const theme of ['light', 'dark'] as const) {
      const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, storageState: s.signedOut ? undefined : storageState });
      const key = `${s.name} ${w} ${theme}`;
      try {
        const p = await c.newPage();
        await p.goto(SERVER + s.url);
        await p.locator('[data-app-ready]').waitFor({ timeout: 30_000 }).catch(() => undefined);
        await p.waitForTimeout(1200);
        await pinTheme(p, theme);
        if (s.setup) await s.setup(p, w);
        await p.waitForTimeout(600);
        const bg = await pinTheme(p, theme);
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        result[key] = { rows: s.rows, bg: bg.color, lum: bg.lum, overflowPx: overflow, contrast: await contrastScan(p) };
      } catch (e) {
        result[key] = { error: String(e).slice(0, 200) };
      }
      await c.close();
    }
await b.close();
console.log(JSON.stringify(result, null, 1));
