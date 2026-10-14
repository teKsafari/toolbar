// Per-tab ring buffer in IndexedDB (architecture s11, D-013). Every event from a tab lands
// here (console, network, user events: J-071 "logs from before the capture"); rrweb lands here
// while instant replay is on or a recording is attached. Nothing in the ring is uploaded until
// the user creates a capture (J-189). The ring is what survives reloads, navigations and
// service worker restarts.
import type { CaptureEvent } from '@toolbar/shared';
import type { RingRow } from '@toolbar/shared/ext';
import { idbDelete, idbGetAll, idbPutMany, openDb } from './idb';

/** rrweb EventType.FullSnapshot. */
const FULL_SNAPSHOT = 2;
/** rrweb EventType.Meta: precedes each full snapshot and carries href and size. */
const META = 4;
/** Soft cap per tab before pruning drops bodies and older rrweb (architecture s11). */
export const RING_TAB_BYTES = 64 * 1024 * 1024;

interface RrwebLike {
  type: number;
  timestamp: number;
}

export interface RingSlice {
  events: CaptureEvent[];
  rrweb: unknown[];
  /** time of the first full snapshot in the slice, or null when rrweb is absent */
  rrwebStart: number | null;
}

const approxBytes = (x: unknown) => {
  try {
    return JSON.stringify(x).length;
  } catch {
    return 1024;
  }
};

/** Pending writes are batched, so a chatty page costs one transaction per flush. */
export class Ring {
  private pending: RingRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private bytes = new Map<number, number>();
  private writing: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(private flushMs = 500) {}

  appendEvents(tabId: number, events: CaptureEvent[]) {
    for (const e of events) {
      const b = approxBytes(e);
      this.pending.push({ tabId, t: e.t, id: e.id, type: 'event', data: e, bytes: b });
      this.bytes.set(tabId, (this.bytes.get(tabId) ?? 0) + b);
    }
    this.schedule();
  }

  appendRrweb(tabId: number, batch: unknown[]) {
    for (const r of batch as RrwebLike[]) {
      const b = approxBytes(r);
      const full = r.type === FULL_SNAPSHOT;
      // rrweb timestamps are Date.now() ms; ids only need to be unique per tab and time.
      this.pending.push({ tabId, t: r.timestamp, id: `rr:${(this.seq++).toString(36)}`, type: 'rrweb', data: r, ...(full ? { full: true } : {}), bytes: b });
      this.bytes.set(tabId, (this.bytes.get(tabId) ?? 0) + b);
    }
    this.schedule();
  }

  private schedule() {
    if (this.pending.length > 2000) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.flushMs);
  }

  /** Writes what is pending. Resolves when it is in IndexedDB. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const rows = this.pending;
    this.pending = [];
    this.writing = this.writing.then(() => idbPutMany('ring', rows)).catch(() => {});
    return this.writing;
  }

  /**
   * Events and rrweb of a tab in [from, to]. rrweb starts at the newest full snapshot at or
   * before `from` (with its meta event), because a replay needs a snapshot to start from.
   */
  async read(tabId: number, from: number, to = Number.MAX_SAFE_INTEGER): Promise<RingSlice> {
    await this.flush();
    const all = await idbGetAll<RingRow>('ring', IDBKeyRange.bound([tabId, -Infinity], [tabId, to, []]));
    const events: CaptureEvent[] = [];
    const rr: RingRow[] = [];
    for (const r of all) {
      if (r.type === 'event') {
        if (r.t >= from) events.push(r.data as CaptureEvent);
      } else rr.push(r);
    }
    let cut = -1;
    for (let i = 0; i < rr.length; i++) if (rr[i]!.full && rr[i]!.t <= from) cut = i;
    if (cut < 0) cut = rr.findIndex((r) => r.full);
    let rrweb: unknown[] = [];
    let rrwebStart: number | null = null;
    if (cut >= 0) {
      // include the meta event just before the full snapshot
      const start = cut > 0 && (rr[cut - 1]!.data as RrwebLike).type === META ? cut - 1 : cut;
      rrweb = rr.slice(start).map((r) => r.data);
      rrwebStart = rr[cut]!.t;
    }
    return { events, rrweb, rrwebStart };
  }

  /**
   * Drops rows older than `keepFrom`, keeping rrweb from the newest full snapshot at or before it.
   * Called every 10 s by the worker with keepFrom = min(now - window, start of an active capture).
   */
  async prune(tabId: number, keepFrom: number): Promise<number> {
    await this.flush();
    const db = await openDb();
    const old = await idbGetAll<RingRow>('ring', IDBKeyRange.bound([tabId, -Infinity], [tabId, keepFrom, []]));
    if (!old.length) return 0;
    let lastFull = -Infinity;
    for (const r of old) if (r.type === 'rrweb' && r.full) lastFull = r.t;
    // the meta row before that snapshot shares or precedes its timestamp by a few ms
    const rrKeepFrom = lastFull === -Infinity ? Infinity : lastFull - 50;
    const tx = db.transaction('ring', 'readwrite');
    const os = tx.objectStore('ring');
    let n = 0;
    let freed = 0;
    for (const r of old) {
      if (r.type === 'rrweb' && r.t >= rrKeepFrom) continue;
      os.delete([r.tabId, r.t, r.id]);
      n++;
      freed += r.bytes;
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    this.bytes.set(tabId, Math.max(0, (this.bytes.get(tabId) ?? 0) - freed));
    return n;
  }

  /** Approximate bytes held for a tab since this worker started. */
  size(tabId: number) {
    return this.bytes.get(tabId) ?? 0;
  }

  async purgeTab(tabId: number) {
    await this.flush();
    this.bytes.delete(tabId);
    await idbDelete('ring', IDBKeyRange.bound([tabId, -Infinity], [tabId, Infinity, []]));
  }

  /** Tab ids with rows, for pruning after a worker restart. */
  async tabs(): Promise<number[]> {
    const db = await openDb();
    const out = new Set<number>();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction('ring').objectStore('ring').openKeyCursor(null, 'nextunique');
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        const tab = (c.key as [number])[0];
        out.add(tab);
        c.continue([tab, Infinity, []] as IDBValidKey);
      };
      req.onerror = () => reject(req.error);
    });
    return [...out];
  }
}
