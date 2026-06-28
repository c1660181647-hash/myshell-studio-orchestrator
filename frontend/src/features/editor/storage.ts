// 剪辑器持久化层：IndexedDB 存素材文件 blob 与项目快照
// 按 projectId 区分，画布1/画布2 各自的剪辑数据互不干扰
import type { EditorSnapshot } from './types';

const DB_NAME = 'myshell-editor';
const DB_VERSION = 1;
const ASSET_STORE = 'assets'; // key: assetId  value: Blob(File)
const SNAPSHOT_STORE = 'snapshots'; // key: projectId  value: EditorSnapshot

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function put(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

export const saveAssetBlob = (assetId: string, blob: Blob) => put(ASSET_STORE, assetId, blob);
export const getAssetBlob = (assetId: string) => get<Blob>(ASSET_STORE, assetId);
export const saveSnapshot = (projectId: string, snapshot: EditorSnapshot) =>
  put(SNAPSHOT_STORE, projectId, snapshot);
export const getSnapshot = (projectId: string) => get<EditorSnapshot>(SNAPSHOT_STORE, projectId);
