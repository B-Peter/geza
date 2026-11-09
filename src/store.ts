// IndexedDB key-value store.
// - get/set: plain app data (mixes, snapshots, pending swaps).
// - getSecret/setSecret: tokens and API keys, encrypted with an AES-GCM key
//   that is generated on first use and marked non-extractable, so page
//   scripts can use it but never read its bytes.

const DB_NAME = "playlist-studio";
const STORE = "kv";
const CRYPTO_KEY_ID = "__crypto_key";

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function rawGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function rawSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function rawDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function get<T>(key: string): Promise<T | undefined> {
  return rawGet<T>(`data:${key}`);
}

export async function set(key: string, value: unknown): Promise<void> {
  await rawSet(`data:${key}`, value);
}

export async function remove(key: string): Promise<void> {
  await rawDelete(`data:${key}`);
}

async function cryptoKey(): Promise<CryptoKey> {
  let key = await rawGet<CryptoKey>(CRYPTO_KEY_ID);
  if (!key) {
    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await rawSet(CRYPTO_KEY_ID, key);
  }
  return key;
}

interface SecretEntry {
  iv: Uint8Array<ArrayBuffer>;
  cipher: ArrayBuffer;
}

export async function setSecret(name: string, value: unknown): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), data);
  await rawSet(`secret:${name}`, { iv, cipher } satisfies SecretEntry);
}

export async function getSecret<T>(name: string): Promise<T | null> {
  const entry = await rawGet<SecretEntry>(`secret:${name}`);
  if (!entry) return null;
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: entry.iv },
    await cryptoKey(),
    entry.cipher,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export async function deleteSecret(name: string): Promise<void> {
  await rawDelete(`secret:${name}`);
}

// Ask the browser not to evict our data under storage pressure (iOS).
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
