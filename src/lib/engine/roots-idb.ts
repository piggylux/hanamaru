import type { FolderEntry, RootStore } from './files.js';

/**
 * The library folders' handles, kept in IndexedDB: the only place a browser keeps them between
 * visits. Both the page (to ask for access) and the engine's worker (to read) open it.
 */
let opening: Promise<IDBDatabase> | undefined;

function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('hanamaru', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('roots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const transaction = (await database()).transaction('roots', mode);
  const request = work(transaction.objectStore('roots'));
  return new Promise<T>((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const idbRoots: RootStore & {
  /** Every library folder's handle, by its id */
  all(): Promise<Map<number, FileSystemDirectoryHandle>>;
} = {
  get: (id) => run('readonly', (store) => store.get(id) as IDBRequest<FolderEntry | undefined>),
  set: async (id, folder) => void (await run('readwrite', (store) => store.put(folder, id))),
  delete: async (id) => void (await run('readwrite', (store) => store.delete(id))),
  async all() {
    // Ids and handles are read together, so they can't change in between
    const transaction = (await database()).transaction('roots', 'readonly');
    const store = transaction.objectStore('roots');
    const keys = store.getAllKeys();
    const values = store.getAll();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return new Map(keys.result.map((key, index) => [Number(key), values.result[index]]));
  },
};
