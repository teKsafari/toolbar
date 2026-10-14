// Better Auth (D-011). Part 1 copies Jam's sign-in options (J-217: Google, GitHub, Apple,
// work email). Apple needs a paid developer account and is on the skip list. Work email is a
// magic link (AUTH_MAGIC_LINK, default on; Mailpit in dev) plus email + password
// (AUTH_EMAIL_PASSWORD, default on in Part 1, off in Part 2). Google, GitHub and any number of
// generic OIDC providers turn on when their env vars are set.
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
import { db } from './db/index.ts';
import * as schema from './db/schema/index.ts';
import { env } from './env.ts';
import { sendMail } from './mail.ts';
import { bootstrapNewUser, joinByDomain } from './auth/workspaces.ts';

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
        `Sign in to ${PRODUCT_NAME}`,
        `Open this link to sign in to ${PRODUCT_NAME} at ${env.publicUrl}:\n\n${url}\n\nIt works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
        `<p>Open this link to sign in to ${PRODUCT_NAME} at ${env.publicUrl}:</p><p><a href="${url}">Sign in to ${PRODUCT_NAME}</a></p>` +
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
    })),
  }),
  // Must stay last: it copies Set-Cookie headers onto SvelteKit's cookies.
  sveltekitCookies(getRequestEvent),
];

export const auth = betterAuth({
  appName: PRODUCT_NAME,
  baseURL: env.publicUrl,
  basePath: '/api/auth',
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  advanced: { database: { generateId: () => uuidv7() } },
  trustedOrigins: [env.publicUrl, ...env.extensionIds.map((id) => `chrome-extension://${id}`)],
  emailAndPassword: { enabled: env.auth.emailPassword, autoSignIn: true, minPasswordLength: 8 },
  user: { additionalFields: { activeWorkspaceId: { type: 'string', required: false, input: false } } },
  // Organization changes go through /api/v1 (seat roles, invite rules); magic link sign-in is
  // started by the login page's server action only.
  disabledPaths: [...ORG_PATHS, ...(env.auth.magicLink ? [] : ['/sign-in/magic-link', '/magic-link/verify'])],
  databaseHooks: {
    user: {
      // X-06, J-125: join a workspace by email domain, or get a personal workspace as owner.
      create: { after: async (u) => void (await bootstrapNewUser(db, u)) },
      // An address verified later (magic link on a password account) can still join by domain.
      update: { after: async (u) => void (u.emailVerified ? await joinByDomain(db, u) : undefined) },
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
