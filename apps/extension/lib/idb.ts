// IndexedDB for the extension origin (service worker, offscreen document, extension pages).
// Layout from @toolbar/shared/ext IDB: uploads, ring, drafts, blobs. Small promise helpers so
// the other areas (drafts, editor) can use the same database.
import { IDB } from '@toolbar/shared/ext';

export type StoreName = keyof typeof IDB.stores;

let dbp: Promise<IDBDatabase> | null = null;

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(IDB.name, IDB.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(IDB.stores)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: opts.keyPath as string | string[] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbp = null;
      };
      db.onclose = () => {
        dbp = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbp = null;
      reject(req.error);
    };
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  return dbp;
}

/** For tests: forget the cached connection. */
export function resetDb() {
  void dbp?.then((d) => d.close()).catch(() => {});
  dbp = null;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await txDone(tx);
}

export async function idbPutMany<T>(store: StoreName, values: T[]): Promise<void> {
  if (!values.length) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  await txDone(tx);
}

export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return done(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbDelete(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

export async function idbGetAll<T>(store: StoreName, range?: IDBKeyRange, count?: number): Promise<T[]> {
  const db = await openDb();
  return done(db.transaction(store).objectStore(store).getAll(range, count)) as Promise<T[]>;
}

export async function idbCount(store: StoreName, range?: IDBKeyRange): Promise<number> {
  const db = await openDb();
  return done(db.transaction(store).objectStore(store).count(range));
}

/** Key range for every compound key that starts with `prefix` (arrays sort after all scalars). */
export function prefixRange(...prefix: IDBValidKey[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}

export interface BlobRowLike {
  id: string;
  blob: Blob;
  type: string;
  createdAt: number;
}

export async function putBlob(id: string, blob: Blob): Promise<string> {
  await idbPut<BlobRowLike>('blobs', { id, blob, type: blob.type, createdAt: Date.now() });
  return id;
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await idbGet<BlobRowLike>('blobs', id))?.blob;
}
