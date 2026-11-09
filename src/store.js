// Encrypted key-value store on top of IndexedDB.
// Secrets are encrypted with an AES-GCM key that is generated on first use,
// marked non-extractable, and kept in the same database. The raw key bytes
// can never be read back by page scripts.

const DB_NAME = "playlist-studio";
const STORE = "kv";
const CRYPTO_KEY_ID = "__crypto_key";

let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function rawGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rawSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function rawDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function cryptoKey() {
  let key = await rawGet(CRYPTO_KEY_ID);
  if (!key) {
    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await rawSet(CRYPTO_KEY_ID, key);
  }
  return key;
}

export async function setSecret(name, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), data);
  await rawSet(`secret:${name}`, { iv, cipher });
}

export async function getSecret(name) {
  const entry = await rawGet(`secret:${name}`);
  if (!entry) return null;
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: entry.iv },
    await cryptoKey(),
    entry.cipher,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function deleteSecret(name) {
  await rawDelete(`secret:${name}`);
}

// Ask the browser not to evict our data under storage pressure (iOS).
export async function requestPersistence() {
  if (navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}
