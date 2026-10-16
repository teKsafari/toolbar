// Instance branding service (D-112): the resolved brand with a short cache, the logo files in
// object storage, the public and admin views, and the admin's changes.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import {
  BRAND_ICON_SIZES,
  BRAND_LOGO_MAX_BYTES,
  brandingStoredSchema,
  DEFAULT_ACCENT,
  type AdminBranding,
  type Branding,
  type BrandingStored,
  type BrandIconSize,
  type LogoRef,
} from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { instanceSetting } from '../db/schema/index.ts';
import { env } from '../env.ts';
import { getBytes, headObject, keys, putObject } from '../s3.ts';
import { BrandImageError, processLogo, renditions, type LogoFiles } from './image.ts';
import { DEFAULT_NAME, defaultIconSvg, defaultLogoSvg, onAccentOf, resolveBrand, validAccent, type Brand } from './resolve.ts';

export type { Brand } from './resolve.ts';
export { BrandImageError } from './image.ts';

const SETTING_KEY = 'branding';
const TTL_MS = 60_000;

let cached: { brand: Brand; at: number } | null = null;
/** the last brand loaded, kept across invalidation for code that cannot wait (mail, MCP text) */
let last: Brand | null = null;
let pending: Promise<Brand> | null = null;
const warned = new Set<string>();

function warnOnce(msg: string) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[branding] ${msg}`);
}

// ---------------------------------------------------------------- env logos

interface EnvLogo {
  url: string;
  ref: LogoRef | null;
}
const envLogos: { light: EnvLogo | null; dark: EnvLogo | null } = { light: null, dark: null };

/** Fetch APP_LOGO_URL (https: or file:, 5 s, 512 KB, same-host redirects only) and store it. */
async function fetchLogoBytes(raw: string): Promise<Uint8Array> {
  let url = new URL(raw);
  if (url.protocol === 'file:') return readFile(fileURLToPath(url));
  if (url.protocol !== 'https:') throw new Error('only https: and file: URLs are allowed');
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') ?? '', url);
      if (next.host !== url.host || next.protocol !== 'https:') throw new Error(`redirect to another host (${next.host})`);
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > BRAND_LOGO_MAX_BYTES) throw new Error('larger than 512 KB');
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf;
  }
  throw new Error('too many redirects');
}

async function envLogo(variant: 'light' | 'dark', url: string): Promise<LogoRef | null> {
  const known = envLogos[variant];
  if (known && known.url === url) return known.ref;
  let ref: LogoRef | null = null;
  try {
    const files = await processLogo(await fetchLogoBytes(url));
    await storeLogoFiles(files);
    ref = files.ref;
  } catch (e) {
    warnOnce(`${variant === 'light' ? 'APP_LOGO_URL' : 'APP_LOGO_DARK_URL'} could not be used (${(e as Error).message}); showing the default`);
  }
  envLogos[variant] = { url, ref };
  return ref;
}

// ---------------------------------------------------------------- resolve

async function readStored(db: Db): Promise<BrandingStored | null> {
  const [row] = await db.select({ value: instanceSetting.value }).from(instanceSetting).where(eq(instanceSetting.key, SETTING_KEY));
  if (!row) return null;
  const r = brandingStoredSchema.safeParse(row.value);
  return r.success ? r.data : null;
}

async function load(db: Db): Promise<Brand> {
  let stored: BrandingStored | null = null;
  try {
    stored = await readStored(db);
  } catch (e) {
    // a server whose database is not ready still renders pages with the default brand
    warnOnce(`stored branding unreadable (${(e as Error).message})`);
  }
  const e = env.brand;
  const light = e.logoUrl ? await envLogo('light', e.logoUrl) : null;
  const dark = e.logoDarkUrl ? await envLogo('dark', e.logoDarkUrl) : null;
  const brand = resolveBrand({
    env: { name: e.name, accent: e.accent },
    envLogo: { light, dark, lightSet: !!e.logoUrl, darkSet: !!e.logoDarkUrl },
    stored,
  });
  for (const w of brand.warnings) warnOnce(w);
  return brand;
}

/** The current brand; re-read at most once a minute, or at once after invalidateBrand(). */
export async function getBrand(db: Db): Promise<Brand> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.brand;
  pending ??= load(db)
    .then((brand) => {
      cached = { brand, at: Date.now() };
      last = brand;
      return brand;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function invalidateBrand() {
  cached = null;
}

/** The brand loaded last, without I/O (mail, MCP text); env or default values before the first load. */
export function currentBrand(): { name: string; accent: string; onAccent: string; version: string } {
  if (last) return last;
  const fallback = resolveBrand({ env: { name: env.brand.name, accent: env.brand.accent }, envLogo: { light: null, dark: null, lightSet: false, darkSet: false }, stored: null });
  return fallback;
}

// ---------------------------------------------------------------- files

const ext = (t: LogoRef['type']) => (t === 'image/svg+xml' ? 'svg' : 'png');

async function storeLogoFiles(f: LogoFiles) {
  const h = f.ref.hash;
  if (await headObject(keys.brand(h, 'email.png'))) return;
  await putObject(keys.brand(h, `logo.${ext(f.ref.type)}`), f.original, f.ref.type);
  for (const n of BRAND_ICON_SIZES) await putObject(keys.brand(h, `icon-${n}.png`), f.icons[n], 'image/png');
  await putObject(keys.brand(h, 'email.png'), f.email, 'image/png');
}

// small in-memory cache: logo files are tiny and keyed by content hash or brand version
const fileCache = new Map<string, Buffer>();
function remember(key: string, b: Buffer): Buffer {
  if (fileCache.size > 200) fileCache.delete(fileCache.keys().next().value!);
  fileCache.set(key, b);
  return b;
}

async function stored(key: string): Promise<Buffer> {
  const hit = fileCache.get(key);
  if (hit) return hit;
  return remember(key, Buffer.from(await getBytes(key)));
}

async function defaultRendition(accent: string, name: string): Promise<Buffer> {
  const k = `default:${accent}:${name}`;
  const hit = fileCache.get(k);
  if (hit) return hit;
  // icons carry an edge so they read on dark browser chrome; mail keeps the plain rectangle
  const r = await renditions(Buffer.from(defaultIconSvg(accent, onAccentOf(accent) ?? '#ffffff')), true);
  for (const n of BRAND_ICON_SIZES) remember(`default:${accent}:icon-${n}.png`, r.icons[n]);
  remember(`default:${accent}:email.png`, (await renditions(Buffer.from(defaultLogoSvg(accent)), true)).email);
  return fileCache.get(k)!;
}

export const BRAND_FILE_RE = /^(logo|logo-dark)\.(svg|png)$|^icon-(16|32|48|128|180|512)\.png$|^email\.png$/;

/** Body and type of a file under /brand/, or null for 404. */
export async function brandFile(b: Brand, name: string): Promise<{ body: Buffer; type: string } | null> {
  if (!BRAND_FILE_RE.test(name)) return null;
  const png = (body: Buffer) => ({ body, type: 'image/png' });
  if (name === 'logo.svg' || name === 'logo.png') {
    const l = b.logo.light;
    if (!l) return name === 'logo.svg' ? { body: Buffer.from(defaultLogoSvg(b.accent, b.accentDark)), type: 'image/svg+xml' } : png(await defaultRendition(b.accent, 'icon-512.png'));
    if (ext(l.type) !== name.split('.')[1]) return null;
    return { body: await stored(keys.brand(l.hash, name)), type: l.type };
  }
  if (name.startsWith('logo-dark.')) {
    const d = b.logo.dark;
    if (!d || ext(d.type) !== name.split('.')[1]) return null;
    return { body: await stored(keys.brand(d.hash, `logo.${ext(d.type)}`)), type: d.type };
  }
  const l = b.logo.light;
  return png(l ? await stored(keys.brand(l.hash, name)) : await defaultRendition(b.accent, name));
}

// ---------------------------------------------------------------- views

export function brandingDto(b: Brand, base = env.publicUrl): Branding {
  const v = `?v=${b.version}`;
  const u = (p: string) => `${base}/brand/${p}${v}`;
  const icons = Object.fromEntries(BRAND_ICON_SIZES.map((n: BrandIconSize) => [String(n), u(`icon-${n}.png`)]));
  return {
    name: b.name,
    accent: b.accent,
    onAccent: b.onAccent,
    version: b.version,
    defaultLogo: !b.logo.light,
    logo: {
      light: u(`logo.${b.logo.light ? ext(b.logo.light.type) : 'svg'}`),
      dark: b.logo.dark ? u(`logo-dark.${ext(b.logo.dark.type)}`) : null,
      icons,
      email: u('email.png'),
    },
  };
}

/** What pages need for the header mark and titles (root layout data). */
export interface PageBrand {
  name: string;
  accent: string;
  version: string;
  defaultLogo: boolean;
  logo: string;
  logoDark: string | null;
}
export function pageBrand(b: Brand): PageBrand {
  const v = `?v=${b.version}`;
  return {
    name: b.name,
    accent: b.accent,
    version: b.version,
    defaultLogo: !b.logo.light,
    logo: `/brand/logo.${b.logo.light ? ext(b.logo.light.type) : 'svg'}${v}`,
    logoDark: b.logo.dark ? `/brand/logo-dark.${ext(b.logo.dark.type)}${v}` : null,
  };
}

export async function adminBranding(db: Db): Promise<AdminBranding> {
  const b = await getBrand(db);
  return { branding: brandingDto(b), stored: (await readStored(db)) ?? {}, locked: b.locked, defaults: { name: DEFAULT_NAME, accent: DEFAULT_ACCENT } };
}

// ---------------------------------------------------------------- changes

export class BrandInvalidError extends Error {}

export class BrandLockedError extends Error {
  constructor(readonly field: string) {
    super(`${field} is set by the server environment`);
  }
}

async function writeStored(db: Db, userId: string, next: BrandingStored) {
  await db
    .insert(instanceSetting)
    .values({ key: SETTING_KEY, value: next, updatedBy: userId })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value: next, updatedBy: userId, updatedAt: new Date() } });
  invalidateBrand();
}

export async function updateBranding(db: Db, userId: string, patch: { name?: string | null; accent?: string | null }): Promise<void> {
  const b = await getBrand(db);
  if (patch.name !== undefined && b.locked.name) throw new BrandLockedError('APP_NAME');
  if (patch.accent !== undefined && b.locked.accent) throw new BrandLockedError('APP_ACCENT');
  if (patch.accent && !validAccent(patch.accent)) throw new BrandInvalidError('No text colour reads well on this accent. Pick a darker or lighter colour.');
  const next: BrandingStored = { ...((await readStored(db)) ?? {}) };
  if (patch.name !== undefined) {
    if (patch.name === null) delete next.name;
    else next.name = patch.name;
  }
  if (patch.accent !== undefined) {
    if (patch.accent === null) delete next.accent;
    else next.accent = patch.accent;
  }
  await writeStored(db, userId, next);
}

export async function setLogo(db: Db, userId: string, variant: 'light' | 'dark', bytes: Uint8Array | null, type?: string | null): Promise<void> {
  const b = await getBrand(db);
  if (variant === 'light' ? b.locked.logo : b.locked.logoDark) throw new BrandLockedError(variant === 'light' ? 'APP_LOGO_URL' : 'APP_LOGO_DARK_URL');
  let ref: LogoRef | undefined;
  if (bytes) {
    const files = await processLogo(bytes, type);
    await storeLogoFiles(files);
    ref = files.ref;
  }
  const next: BrandingStored = { ...((await readStored(db)) ?? {}) };
  const logo = { ...(next.logo ?? {}) };
  if (ref) logo[variant] = ref;
  else delete logo[variant];
  next.logo = logo;
  await writeStored(db, userId, next);
}
