import type { BlobStore } from './files.js';

/** A folder in the site's private storage (OPFS), made on the way when `create` is set */
async function folderAt(names: string[], create: boolean) {
  let folder = await navigator.storage.getDirectory();
  for (const name of names) {
    try {
      folder = await folder.getDirectoryHandle(name, { create });
    } catch {
      return undefined;
    }
  }
  return folder;
}

const split = (path: string) => {
  const names = path.split('/').filter(Boolean);
  return { folders: names.slice(0, -1), name: names.at(-1)! };
};

/** hanamaru's thumbnails, kept in the site's private storage beside the database */
export const opfsStore: BlobStore = {
  async read(path) {
    const { folders, name } = split(path);
    const folder = await folderAt(folders, false);
    if (!folder) return undefined;
    try {
      return await (await folder.getFileHandle(name)).getFile();
    } catch {
      return undefined;
    }
  },

  async write(path, data) {
    const { folders, name } = split(path);
    const folder = (await folderAt(folders, true))!;
    const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
  },

  async remove(path) {
    const { folders, name } = split(path);
    const folder = await folderAt(folders, false);
    try {
      await folder?.removeEntry(name, { recursive: true });
    } catch {
      // Already gone
    }
  },
};
