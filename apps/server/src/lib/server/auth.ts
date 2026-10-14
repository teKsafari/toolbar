// Better Auth (D-011). Part 1 copies Jam's sign-in options (J-217: Google, GitHub, Apple,
// work email). Apple needs a paid developer account and is on the skip list; work email is
// email + password for local dev (AUTH_EMAIL_PASSWORD, default on in Part 1, off in Part 2).
// Google, GitHub and any number of generic OIDC providers turn on when their env vars are set.
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { organization } from 'better-auth/plugins/organization';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { uuidv7, PRODUCT_NAME } from '@toolbar/shared';
import { db } from './db/index.ts';
import * as schema from './db/schema/index.ts';
import { env } from './env.ts';
import { sendMail } from './mail.ts';

const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
if (env.auth.google.clientId)
  socialProviders.google = { clientId: env.auth.google.clientId, clientSecret: env.auth.google.clientSecret };
if (env.auth.github.clientId)
  socialProviders.github = { clientId: env.auth.github.clientId, clientSecret: env.auth.github.clientSecret };

const plugins = [
  organization({
    async sendInvitationEmail({ email, organization: org, inviter, id }) {
      const url = `${env.publicUrl}/invite/${id}`;
      await sendMail(email, `${inviter.user.name} invited you to ${org.name}`, `Join ${org.name} on ${PRODUCT_NAME}: ${url}`);
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
  databaseHooks: {
    user: {
      // Every new user gets a personal workspace, so a first capture has somewhere to go.
      create: { after: async (u) => void (await createPersonalWorkspace(u.id, u.name || u.email)) },
    },
  },
  socialProviders,
  plugins,
});

async function createPersonalWorkspace(userId: string, name: string) {
  const id = uuidv7();
  await db.insert(schema.organization).values({ id, name: `${name.split('@')[0]}'s workspace`, slug: `w-${id.slice(-12)}` });
  await db.insert(schema.member).values({ organizationId: id, userId, role: 'owner' });
}

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;

/** Sign-in options the login page shows, in Jam's order (J-217) minus Apple. */
export function signInOptions() {
  return {
    emailPassword: env.auth.emailPassword,
    providers: [
      ...(env.auth.github.clientId ? [{ id: 'github', name: 'GitHub', kind: 'social' as const }] : []),
      ...(env.auth.google.clientId ? [{ id: 'google', name: 'Google', kind: 'social' as const }] : []),
      ...env.auth.oidc.map((p) => ({ id: p.providerId, name: p.name, kind: 'oidc' as const })),
    ],
  };
}
