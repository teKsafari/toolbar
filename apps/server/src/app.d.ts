import type { Session } from '#lib/server/auth.ts';

declare global {
  namespace App {
    interface Locals {
      user: Session['user'] | null;
      session: Session['session'] | null;
      /** Set when the request authenticated with `Authorization: Bearer tb_...`. */
      apiToken: { id: string; kind: 'device' | 'personal' } | null;
    }
    interface Error {
      code?: string;
    }
  }
}

export {};
