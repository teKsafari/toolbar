import type { Session } from '#lib/server/auth.ts';

declare global {
  namespace App {
    interface Locals {
      user: Session['user'] | null;
      session: Session['session'] | null;
      /** Set when the request authenticated with `Authorization: Bearer tb_...`. */
      apiToken: { id: string; kind: 'device' | 'personal'; scopes?: string[] } | null;
      /** instance branding, resolved per request from a one-minute cache (D-112) */
      brand: import('#lib/server/branding/resolve.ts').Brand;
    }
    interface Error {
      code?: string;
    }
  }
}

export {};
