// Instance branding (D-074, D-083, D-112): the product name, logo and accent colour a server
// shows. Precedence per field: env var (field locked) > value stored by an instance admin > default.
import { z } from 'zod';
import { api, defineRoute } from './common.ts';

/** Default accent: black, as teksafari.org (D-175); the dark theme inverts it to near-white. */
export const DEFAULT_ACCENT = '#000000';
/** Icon sizes the server renders from the logo (favicons, apple-touch, extension icons). */
export const BRAND_ICON_SIZES = [16, 32, 48, 128, 180, 512] as const;
export type BrandIconSize = (typeof BRAND_ICON_SIZES)[number];
export const BRAND_LOGO_MAX_BYTES = 512 * 1024;
export const BRAND_PNG_MAX_SIDE = 2048;
export const BRAND_LOGO_TYPES = ['image/svg+xml', 'image/png'] as const;

/** Letters, digits, spaces and a little punctuation; 1 to 40 characters. */
export const BRAND_NAME_RE = /^[\p{L}\p{N} .,'&()+_-]{1,40}$/u;
export const brandNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().regex(BRAND_NAME_RE, 'Use 1 to 40 letters, digits, spaces or . , \' & ( ) + _ -'));
export const accentSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0b7a5c')
  .transform((s) => s.toLowerCase());

export const logoRefSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  type: z.enum(BRAND_LOGO_TYPES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type LogoRef = z.infer<typeof logoRefSchema>;

/** `instance_setting` row `branding`. */
export const brandingStoredSchema = z.object({
  name: z.string().optional(),
  accent: z.string().optional(),
  logo: z.object({ light: logoRefSchema.optional(), dark: logoRefSchema.optional() }).optional(),
});
export type BrandingStored = z.infer<typeof brandingStoredSchema>;

/** Public branding: what pages, the extension and the CLI show. URLs are absolute. */
export const brandingSchema = z.object({
  name: z.string(),
  accent: z.string(),
  onAccent: z.string(),
  version: z.string(),
  /** true while the logo is the built-in rectangle */
  defaultLogo: z.boolean(),
  logo: z.object({
    light: z.string(),
    dark: z.string().nullable(),
    icons: z.record(z.string(), z.string()),
    email: z.string(),
  }),
});
export type Branding = z.infer<typeof brandingSchema>;

export const brandLockSchema = z.object({ name: z.boolean(), logo: z.boolean(), logoDark: z.boolean(), accent: z.boolean() });
export type BrandLocks = z.infer<typeof brandLockSchema>;

export const adminBrandingSchema = z.object({
  branding: brandingSchema,
  stored: brandingStoredSchema,
  locked: brandLockSchema,
  defaults: z.object({ name: z.string(), accent: z.string() }),
});
export type AdminBranding = z.infer<typeof adminBrandingSchema>;

export const updateBrandingBodySchema = z.object({
  /** null resets to the default */
  name: brandNameSchema.nullable().optional(),
  accent: accentSchema.nullable().optional(),
});

export const logoVariantQuerySchema = z.object({ variant: z.enum(['light', 'dark']).default('light') });

export const getBranding = defineRoute({
  name: 'branding.get',
  method: 'GET',
  path: api('/branding'),
  auth: 'public',
  response: brandingSchema,
  area: 'server-core',
  tasks: ['D-074'],
  summary: 'The instance name, logo, icon and accent colour, for pages, the extension and the CLI.',
});

export const getAdminBranding = defineRoute({
  name: 'branding.adminGet',
  method: 'GET',
  path: api('/admin/branding'),
  auth: 'session',
  response: adminBrandingSchema,
  area: 'server-core',
  tasks: ['D-074'],
  summary: 'Instance admins: stored branding, which fields the server environment locks, and the defaults.',
});

export const updateBranding = defineRoute({
  name: 'branding.update',
  method: 'PUT',
  path: api('/admin/branding'),
  auth: 'session',
  body: updateBrandingBodySchema,
  response: adminBrandingSchema,
  errors: ['locked_by_env'],
  area: 'server-core',
  tasks: ['D-074'],
  summary: 'Instance admins: set or reset the instance name and accent colour.',
});

export const uploadBrandLogo = defineRoute({
  name: 'branding.uploadLogo',
  method: 'PUT',
  path: api('/admin/branding/logo'),
  auth: 'session',
  query: logoVariantQuerySchema,
  body: 'multipart',
  response: adminBrandingSchema,
  errors: ['locked_by_env', 'too_large', 'unsupported_media_type', 'invalid_image'],
  area: 'server-core',
  tasks: ['D-074'],
  summary: 'Instance admins: upload the light or dark logo (SVG or PNG, at most 512 KB).',
});

export const deleteBrandLogo = defineRoute({
  name: 'branding.deleteLogo',
  method: 'DELETE',
  path: api('/admin/branding/logo'),
  auth: 'session',
  query: logoVariantQuerySchema,
  response: adminBrandingSchema,
  errors: ['locked_by_env'],
  area: 'server-core',
  tasks: ['D-074'],
  summary: 'Instance admins: remove an uploaded logo; the light logo falls back to the rectangle.',
});

export const brandingRoutes = [getBranding, getAdminBranding, updateBranding, uploadBrandLogo, deleteBrandLogo] as const;
