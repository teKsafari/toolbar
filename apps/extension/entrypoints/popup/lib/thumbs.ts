// Draft thumbnails from the extension's IndexedDB `blobs` store (capture and editor write it).
// Read-only: never opens the database when it does not exist yet, so it cannot create it at
// the wrong version.
import { IDB } from '@toolbar/shared/ext';

let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  dbp ??= (async () => {
    const list = await indexedDB.databases?.().catch(() => []);
    if (!list?.some((d) => d.name === IDB.name)) return null;
    return new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(IDB.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => {
        req.transaction?.abort();
        resolve(null);
      };
    });
  })();
  return dbp;
}

/** Object URL for a blob id, or null. */
export async function blobUrl(id: string | null): Promise<string | null> {
  if (!id) return null;
  const d = await db();
  if (!d || !d.objectStoreNames.contains('blobs')) return null;
  return new Promise((resolve) => {
    const req = d.transaction('blobs').objectStore('blobs').get(id);
    req.onsuccess = () => {
      const row = req.result as { blob?: Blob } | undefined;
      resolve(row?.blob ? URL.createObjectURL(row.blob) : null);
    };
    req.onerror = () => resolve(null);
  });
}
