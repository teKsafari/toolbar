import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { auth, signInOptions } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export const load = ({ locals, url }) => {
  if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
  return { options: signInOptions(), next: safeNext(url.searchParams.get('next')) };
};

export const actions = {
  /** One form for sign-in and sign-up, like the observed single page (J-217). */
  email: async ({ request, url }) => {
    const f = await request.formData();
    const email = String(f.get('email') ?? '').trim().toLowerCase();
    const password = String(f.get('password') ?? '');
    const next = safeNext(String(f.get('next') ?? url.searchParams.get('next') ?? '/'));
    if (!email || !password) return fail(400, { email, message: 'Enter your email and a password.' });
    const exists = (await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)).length > 0;
    try {
      if (exists) await auth.api.signInEmail({ body: { email, password }, headers: request.headers });
      else await auth.api.signUpEmail({ body: { email, password, name: email.split('@')[0]! }, headers: request.headers });
    } catch (e) {
      const message = e instanceof APIError ? e.body?.message ?? e.message : 'Sign-in failed.';
      return fail(400, { email, message });
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
    const res = await auth.api.signInSocial({ body: { provider: id as 'google', callbackURL }, headers: request.headers });
    if (res?.url) redirect(303, res.url);
    return fail(500, { message: 'The provider did not return a sign-in URL.' });
  },
};
