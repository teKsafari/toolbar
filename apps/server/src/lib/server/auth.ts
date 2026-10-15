// Better Auth (D-011). Sign-in follows the owner's scope (docs/scope.md, D-080, J-217): one
// generic OIDC provider set by the admin (OIDC_1_*), limited by AUTH_ALLOWED_DOMAINS. Email and
// password exist for development and tests only (AUTH_DEV_PASSWORD=1, off by default); the
// magic link is paused with the rest of mail (FEATURE_EMAIL). Google and GitHub buttons appear
// only when their client ids are set, which the default deployment does not do.
//
// Workspaces are Better Auth organizations, but every workspace change goes through /api/v1
// (lib/server/auth/*.ts), which knows our seat roles; the plugin's own HTTP endpoints are off.
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { organization } from 'better-auth/plugins/organization';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { uuidv7, PRODUCT_NAME } from '@toolbar/shared';
import { currentBrand } from './branding/index.ts';
import { db } from './db/index.ts';
import * as schema from './db/schema/index.ts';
import { env } from './env.ts';
import { sendMail } from './mail.ts';
import { bootstrapNewUser, joinByDomain } from './auth/workspaces.ts';
import { claimFolderInvites } from './share/access.ts';
import { eq } from 'drizzle-orm';
import { APIError } from 'better-auth/api';

const DOMAIN_REFUSED = 'This server only lets in addresses of its allowed email domains.';
/** Is this address on the email-domain allowlist? An empty list lets everyone in. */
export function domainAllowed(email: string | null | undefined): boolean {
  const list = env.auth.allowedDomains;
  if (!list.length) return true;
  const domain = (email ?? '').toLowerCase().split('@')[1] ?? '';
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const ORG_PATHS = [
  'accept-invitation', 'add-team-member', 'cancel-invitation', 'check-slug', 'create', 'create-role', 'create-team',
  'delete', 'delete-role', 'get-active-member', 'get-active-member-role', 'get-full-organization', 'get-invitation',
  'get-organization', 'get-role', 'has-permission', 'invite-member', 'leave', 'list', 'list-invitations', 'list-members',
  'list-roles', 'list-team-members', 'list-teams', 'list-user-invitations', 'list-user-teams', 'reject-invitation',
  'remove-member', 'remove-team', 'remove-team-member', 'set-active', 'set-active-team', 'update', 'update-member-role',
  'update-role', 'update-team',
].map((p) => `/organization/${p}`);

const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
if (env.auth.google.clientId)
  socialProviders.google = { clientId: env.auth.google.clientId, clientSecret: env.auth.google.clientSecret };
if (env.auth.github.clientId)
  socialProviders.github = { clientId: env.auth.github.clientId, clientSecret: env.auth.github.clientSecret };

const plugins = [
  organization(),
  magicLink({
    expiresIn: 15 * 60,
    disableSignUp: !env.auth.magicLink,
    async sendMagicLink({ email, url }) {
      await sendMail(
        email,
        `Sign in to ${currentBrand().name}`,
        `Open this link to sign in to ${currentBrand().name} at ${env.publicUrl}:\n\n${url}\n\nIt works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
        `<p>Open this link to sign in to ${currentBrand().name} at ${env.publicUrl}:</p><p><a href="${url}">Sign in to ${currentBrand().name}</a></p>` +
          `<p style="color:#666">It works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`,
      );
    },
  }),
  // Always present (an empty list is fine) so its endpoints stay in the inferred API type.
  genericOAuth({
    config: env.auth.oidc.map((p) => ({
      providerId: p.providerId,
      discoveryUrl: p.discoveryUrl,
      clientId: p.clientId,
      clientSecret: p.clientSecret,
      scopes: p.scopes,
      pkce: true,
      // Google Workspace sends `hd`, the hosted domain: it must be on the allowlist too (docs/scope.md)
      mapProfileToUser: (profile: Record<string, unknown>) => {
        const hd = typeof profile.hd === 'string' ? profile.hd.toLowerCase() : null;
        if (hd && env.auth.allowedDomains.length && !env.auth.allowedDomains.includes(hd)) throw new APIError('FORBIDDEN', { message: DOMAIN_REFUSED });
        return {};
      },
    })),
  }),
  // Must stay last: it copies Set-Cookie headers onto SvelteKit's cookies.
  sveltekitCookies(getRequestEvent),
];

export const auth = betterAuth({
  appName: env.brand.name || PRODUCT_NAME,
  baseURL: env.publicUrl,
  basePath: '/api/auth',
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  advanced: { database: { generateId: () => uuidv7() } },
  rateLimit: { enabled: env.auth.rateLimit },
  // errors of a provider round trip land on the sign-in page, which names them (J-217)
  onAPIError: { errorURL: `${env.publicUrl}/login` },
  trustedOrigins: [env.publicUrl, ...env.extensionIds.map((id) => `chrome-extension://${id}`)],
  emailAndPassword: { enabled: env.auth.emailPassword, autoSignIn: true, minPasswordLength: 8 },
  user: { additionalFields: { activeWorkspaceId: { type: 'string', required: false, input: false } } },
  // Organization changes go through /api/v1 (seat roles, invite rules); magic link sign-in is
  // started by the login page's server action only.
  disabledPaths: [...ORG_PATHS, ...(env.auth.magicLink ? [] : ['/sign-in/magic-link', '/magic-link/verify'])],
  databaseHooks: {
    user: {
      // X-06, J-125: join a workspace by email domain, or get a personal workspace as owner.
      create: {
        // only addresses of the allowed domains get an account (AUTH_ALLOWED_DOMAINS, docs/scope.md)
        // returning false stops the sign-up; a provider callback then sends the person back to
        // the sign-in page with error=unable_to_create_user, which explains the allowlist
        before: async (u) => (domainAllowed(u.email) ? { data: u } : false),
        after: async (u) => {
          await bootstrapNewUser(db, u);
          await claimFolderInvites(db, u.id, u.email); // J-122: folder invites sent before the account existed
        },
      },
      // An address verified later (magic link on a password account) can still join by domain.
      // Only on a verification request, so a profile edit never re-adds someone an admin removed.
      update: {
        after: async (u, ctx) => void (u.emailVerified && /verify/.test(ctx?.path ?? '') ? await joinByDomain(db, u) : undefined),
      },
    },
    session: {
      // each sign-in ties folder invites made to the address since the last one (J-122)
      create: {
        // an account made before the allowlist changed cannot sign in from a refused domain
        before: async (s) => {
          if (!env.auth.allowedDomains.length) return { data: s };
          const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, s.userId)).limit(1);
          if (u && !domainAllowed(u.email)) return false;
          return { data: s };
        },
        after: async (s) => {
          const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, s.userId)).limit(1);
          await claimFolderInvites(db, s.userId, u?.email).catch(() => undefined);
        },
      },
    },
  },
  socialProviders,
  plugins,
});


export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;

/** Sign-in options the login page shows, in Jam's order (J-217) minus Apple. */
export function signInOptions() {
  return {
    emailPassword: env.auth.emailPassword,
    magicLink: env.auth.magicLink,
    providers: [
      ...(env.auth.github.clientId ? [{ id: 'github', name: 'GitHub', kind: 'social' as const }] : []),
      ...(env.auth.google.clientId ? [{ id: 'google', name: 'Google', kind: 'social' as const }] : []),
      ...env.auth.oidc.map((p) => ({ id: p.providerId, name: p.name, kind: 'oidc' as const })),
    ],
  };
}
