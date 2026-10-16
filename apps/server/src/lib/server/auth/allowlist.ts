// The sign-in allowlist (docs/scope.md, "Sign-in", D-094, D-114): only addresses of the allowed
// email domains get an account, a session or a working token. Kept free of Better Auth imports,
// so token resolution can use it without loading the auth instance. The list is an instance
// setting (D-187): ALLOWED_EMAIL_DOMAINS when set, else Settings > Server.
import { allowedDomains } from '../settings/index.ts';

export const DOMAIN_REFUSED = 'This server only lets in addresses of its allowed email domains.';

/** Is this address on the email-domain allowlist (a domain or one of its subdomains)? An empty list lets everyone in. */
export function domainAllowed(email: string | null | undefined, list: string[] = allowedDomains()): boolean {
  if (!list.length) return true;
  const domain = (email ?? '').toLowerCase().split('@')[1] ?? '';
  return !!domain && list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Checks on the provider's claims before an account is made or linked: with an allowlist set,
 * the address must be verified (`email_verified` not false), on the list, and Google's `hd`
 * hosted-domain claim, when sent, must be on the list too. Returns the refusal reason, or null.
 */
export function claimsRefusal(profile: Record<string, unknown>, list: string[] = allowedDomains()): string | null {
  if (!list.length) return null;
  const email = typeof profile.email === 'string' ? profile.email : '';
  if (profile.email_verified === false || profile.email_verified === 'false') return 'unverified';
  if (!domainAllowed(email, list)) return 'domain';
  const hd = typeof profile.hd === 'string' ? profile.hd.toLowerCase() : null;
  if (hd && !domainAllowed(`x@${hd}`, list)) return 'hd';
  return null;
}
