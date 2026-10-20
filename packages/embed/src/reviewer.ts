// Who leaves the notes in the embed (D-211): no account, a random id per browser and an optional
// name, kept in the page origin's localStorage. The site can name the reviewer (data-name and
// data-email on the script tag, or init's `user`); then the composer does not ask.
import type { ReviewerIdentity } from '@toolbar/review/platform';
import type { EmbedReviewer } from './client.ts';

export const REVIEWER_KEY = 'tb:embed-reviewer';

interface Stored {
  id: string;
  name?: string;
  /** the composer asked once */
  asked?: boolean;
}

function local(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return 'r_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const clean = (s: string | undefined, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '') || undefined;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ReviewerStore implements ReviewerIdentity {
  private stored: Stored;
  private site: { name?: string; email?: string };

  constructor(site: { name?: string; email?: string } = {}, private storage: Storage | null = local()) {
    this.site = { name: clean(site.name, 80), email: clean(site.email, 200) };
    let s: Stored | null = null;
    try {
      const raw = this.storage?.getItem(REVIEWER_KEY);
      s = raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      s = null;
    }
    if (!s || typeof s.id !== 'string' || !/^[\w-]{1,64}$/.test(s.id)) s = { ...(s ?? {}), id: randomId() };
    this.stored = s;
    this.write();
  }

  private write() {
    try {
      this.storage?.setItem(REVIEWER_KEY, JSON.stringify(this.stored));
    } catch {
      /* blocked: a new id per page load */
    }
  }

  /** What goes with a capture: the id, and the name and email when known. */
  get(): EmbedReviewer {
    const name = this.stored.name || this.site.name;
    const email = this.site.email && EMAIL.test(this.site.email) ? this.site.email : undefined;
    return { id: this.stored.id, ...(name ? { name } : {}), ...(email ? { email } : {}) };
  }

  async load() {
    return { name: this.stored.name || this.site.name || '', ask: !this.site.name && !this.stored.asked };
  }

  async save(name: string) {
    this.stored = { ...this.stored, name: clean(name, 80), asked: true };
    this.write();
  }
}
