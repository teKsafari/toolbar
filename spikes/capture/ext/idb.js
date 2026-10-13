// Tiny IndexedDB file store shared by the service worker and the offscreen document.
// Both run on the extension origin, so they see the same database.
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('spike', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(name, blob) {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, name);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(name) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction('files').objectStore('files').get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
