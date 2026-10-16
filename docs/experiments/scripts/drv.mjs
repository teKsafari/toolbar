// Driver helpers for the Nuru experiments on display :262 (own Chromium over CDP 9462).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire('/home/dev/toolbar/e2e/package.json');
const { chromium } = require('@playwright/test');

export const D = ':262';
export const EXT_ID = 'fmongfmimgdafigcahdpofnmmhljpnei';
export const SERVER = process.env.TB_SERVER ?? 'http://localhost:3000';
export const NURU = 'https://116.nuru.sh';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const LOG = '/home/dev/nuru-exp/steps.log';
const t0 = Number(fs.existsSync('/home/dev/nuru-exp/t0') ? fs.readFileSync('/home/dev/nuru-exp/t0', 'utf8') : Date.now());
export function log(msg) {
  const line = `${new Date().toISOString()} +${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

export function xdo(...args) {
  return execFileSync('xdotool', args, { env: { ...process.env, DISPLAY: D }, encoding: 'utf8' }).trim();
}
export function xshot(file) {
  execFileSync('import', ['-window', 'root', file], { env: { ...process.env, DISPLAY: D } });
}
/** The browser window (not DevTools). */
export function browserWin() {
  const ws = xdo('search', '--onlyvisible', '--name', 'Chrom').split('\n').filter(Boolean);
  return ws.find((w) => !xdo('getwindowname', w).startsWith('DevTools')) ?? ws[0];
}
export function key(...keys) {
  const w = browserWin();
  xdo('windowactivate', '--sync', w);
  for (const k of keys) xdo('key', '--clearmodifiers', k);
}
export function type(text, delay = 60) {
  xdo('type', '--delay', String(delay), text);
}
/** Screen coordinates of a page point: the page's viewport origin inside the window. */
export async function screenOf(page, x, y) {
  const o = await page.evaluate(() => ({ sx: window.screenX, sy: window.screenY, oh: window.outerHeight, ih: window.innerHeight, ow: window.outerWidth, iw: window.innerWidth }));
  return { x: o.sx + (o.ow - o.iw) / 2 + x, y: o.sy + (o.oh - o.ih) + y };
}
/** Real pointer: move with steps and click at a page point. */
export async function clickAt(page, x, y, opts = {}) {
  const p = await screenOf(page, x, y);
  xdo('mousemove', '--sync', String(Math.round(p.x)), String(Math.round(p.y)));
  await sleep(opts.hover ?? 250);
  xdo('click', String(opts.button ?? 1));
}
export async function clickEl(page, locator, opts = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  const b = await locator.boundingBox();
  if (!b) throw new Error('no box for ' + locator);
  await clickAt(page, b.x + (opts.dx ?? b.width / 2), b.y + (opts.dy ?? b.height / 2), opts);
}
export async function dragScreen(page, pts) {
  const s = await Promise.all(pts.map(([x, y]) => screenOf(page, x, y)));
  xdo('mousemove', '--sync', String(Math.round(s[0].x)), String(Math.round(s[0].y)));
  xdo('mousedown', '1');
  for (const p of s.slice(1)) {
    xdo('mousemove', '--sync', String(Math.round(p.x)), String(Math.round(p.y)));
    await sleep(60);
  }
  xdo('mouseup', '1');
}

export async function connect() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9462');
  const ctx = browser.contexts()[0];
  return { browser, ctx };
}
export async function sw(ctx) {
  return ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`)) ?? (await ctx.waitForEvent('serviceworker', { timeout: 10_000 }));
}
export async function nuruPage(ctx) {
  return ctx.pages().find((p) => p.url().startsWith(NURU));
}
