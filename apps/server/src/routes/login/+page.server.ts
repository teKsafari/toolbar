import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { auth, signInOptions } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { env } from '#lib/server/env.ts';

/** Only same-origin paths; /ext/connect?... comes back here during extension sign-in (X-05). */
const safeNext = (n: string | null | undefined) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.publicUrl);
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const messageOf = (e: unknown, fallback: string) => (e instanceof APIError ? (e.body?.message ?? e.message) : fallback);

export const load = ({ locals, url }) => {
  const next = safeNext(url.searchParams.get('next'));
  if (locals.user) redirect(303, next);
  return {
    options: signInOptions(),
    next,
    /** set when the request came from the extension's sign-in window */
    fromExtension: next.startsWith('/ext/connect'),
    mailHint: isLocal ? 'http://localhost:8025' : null,
    error: url.searchParams.get('error'),
  };
};

export const actions = {
  /** Work email (J-217): mail a one-time sign-in link; the link creates the account when new. */
  magic: async ({ request }) => {
    const f = await request.formData();
    const email = String(f.get('email') ?? '').trim().toLowerCase();
    const next = safeNext(String(f.get('next') ?? '/'));
    if (!emailRe.test(email)) return fail(400, { email, mode: 'magic', message: 'Enter a valid email address.' });
    try {
      await auth.api.signInMagicLink({
        body: { email, name: email.split('@')[0], callbackURL: next, errorCallbackURL: `/login?next=${encodeURIComponent(next)}` },
        headers: request.headers,
      });
    } catch (e) {
      return fail(400, { email, mode: 'magic', message: messageOf(e, 'Could not send the sign-in email. Try again.') });
    }
    return { sent: true, email };
  },
  /** One form for sign-in and sign-up with a password, like the observed single page (J-217). */
  password: async ({ request }) => {
    const f = await request.formData();
    const email = String(f.get('email') ?? '').trim().toLowerCase();
    const password = String(f.get('password') ?? '');
    const next = safeNext(String(f.get('next') ?? '/'));
    if (!emailRe.test(email) || !password) return fail(400, { email, mode: 'password', message: 'Enter your email and a password.' });
    const exists = (await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)).length > 0;
    try {
      if (exists) await auth.api.signInEmail({ body: { email, password }, headers: request.headers });
      else await auth.api.signUpEmail({ body: { email, password, name: email.split('@')[0]! }, headers: request.headers });
    } catch (e) {
      return fail(400, { email, mode: 'password', message: messageOf(e, 'Sign-in failed.') });
    }
    redirect(303, next);
  },
  provider: async ({ request }) => {
    const f = await request.formData();
    const id = String(f.get('provider') ?? '');
    const callbackURL = safeNext(String(f.get('next') ?? '/'));
    const opt = signInOptions().providers.find((p) => p.id === id);
    if (!opt) return fail(400, { message: 'Unknown sign-in provider.' });
    // In better-auth 1.7 generic OAuth providers sign in through the same social endpoint.
    const res = await auth.api.signInSocial({
      body: { provider: id as 'google', callbackURL, errorCallbackURL: `/login?next=${encodeURIComponent(callbackURL)}` },
      headers: request.headers,
    });
    if (res?.url) redirect(303, res.url);
    return fail(500, { message: 'The provider did not return a sign-in URL.' });
  },
};
