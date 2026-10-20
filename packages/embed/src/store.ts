// The embed's unsent notes (D-212): the list in memory and in sessionStorage, so it survives
// navigations within the tab as the extension's does, and the crops and voice clips in the page
// origin's IndexedDB (in memory where IndexedDB is blocked). Clips the reviewer never sent are
// swept after two days.
import type { CaptureEvent } from '@toolbar/shared';
import type { ReviewItem } from '@toolbar/shared/ext';

/** An item plus what only the store keeps: the raw events its context names. */
export interface StoredItem extends ReviewItem {
  ctxEvents: CaptureEvent[];
}
export interface TabReview {
  items: StoredItem[];
  nextN: number;
}

export const ITEMS_KEY = 'tb:embed-review';
const DB = 'open-toolbar-embed';
const BLOBS = 'blobs';
export const BLOB_MAX_AGE_MS = 2 * 24 * 3600_000;

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export class ItemStore {
  state: TabReview = { items: [], nextN: 1 };
  constructor(private storage: Storage | null = session()) {
    try {
      const raw = this.storage?.getItem(ITEMS_KEY);
      const s = raw ? (JSON.parse(raw) as TabReview) : null;
      if (s && Array.isArray(s.items)) this.state = { items: s.items, nextN: Number.isInteger(s.nextN) ? s.nextN : s.items.length + 1 };
    } catch {
      /* unreadable: start empty */
    }
  }

  save() {
    try {
      this.storage?.setItem(ITEMS_KEY, JSON.stringify(this.state));
    } catch {
      /* full or blocked: the list lasts as long as this page */
    }
  }
}

export class BlobStore {
  private memory = new Map<string, Blob>();
  private db: Promise<IDBDatabase | null>;

  constructor() {
    this.db = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(BLOBS);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.db;
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const t = db.transaction(BLOBS, mode);
        const r = run(t.objectStore(BLOBS));
        t.oncomplete = () => resolve(r ? r.result : undefined);
        t.onerror = () => resolve(undefined);
        t.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async put(prefix: string, blob: Blob): Promise<string> {
    const id = `${prefix}-${crypto.getRandomValues(new Uint32Array(2)).join('')}-${Date.now().toString(36)}`;
    this.memory.set(id, blob);
    await this.tx('readwrite', (s) => s.put({ blob, t: Date.now() }, id));
    return id;
  }

  async get(id: string): Promise<Blob | undefined> {
    const m = this.memory.get(id);
    if (m) return m;
    const row = (await this.tx<{ blob: Blob } | undefined>('readonly', (s) => s.get(id))) as { blob: Blob } | undefined;
    return row?.blob;
  }

  async delete(id: string): Promise<void> {
    this.memory.delete(id);
    await this.tx('readwrite', (s) => s.delete(id));
  }

  /** Drop clips older than `maxAgeMs` that no tab sent. */
  async sweep(maxAgeMs = BLOB_MAX_AGE_MS, now = Date.now()): Promise<void> {
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const t = db.transaction(BLOBS, 'readwrite');
        const req = t.objectStore(BLOBS).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return;
          if (now - ((c.value as { t?: number }).t ?? 0) > maxAgeMs) c.delete();
          c.continue();
        };
        t.oncomplete = () => resolve();
        t.onerror = () => resolve();
        t.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
