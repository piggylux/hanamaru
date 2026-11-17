import type { Engine } from '../context.js';
import {
  FolderAccessError,
  findEntry,
  relativeTo,
  type FileEntry,
  type FolderEntry,
} from '../files.js';
import { imageType, type GalleryKind } from '../images.js';
import { readZipDirectory, readZipEntry, zipEntryBlob, type ZipEntry } from './zip.js';

export type ArchiveEntry = { name: string; size: number };

/** What the reader and thumbnails need to find a gallery's files */
export type GallerySource = {
  id: number;
  rootId: number;
  /** The library folder's name, which starts every path stored for it */
  rootPath: string;
  path: string;
  kind: GalleryKind;
  fingerprint: string;
};

/** A gallery's files, from its folder or its ZIP archive */
export type GalleryContents = {
  /** Every file, pages or not. Folders list only their own files, not subfolders */
  list(): Promise<ArchiveEntry[]>;
  read(name: string): Promise<Blob>;
  /** The first bytes of a file, which is all an image header needs */
  head(name: string, bytes?: number): Promise<Uint8Array>;
};

const HEAD_BYTES = 256 * 1024;

/** Opens a gallery's folder or archive. A ZIP's directory is read straight away, once */
export async function galleryContents(
  entry: FolderEntry | FileEntry,
  kind: GalleryKind
): Promise<GalleryContents> {
  if (kind === 'folder') {
    const folder = entry as FolderEntry;
    const file = async (name: string) => (await folder.getFileHandle(name)).getFile();
    /** A page with its image type, whichever the browser guessed from the name */
    const read = async (name: string) => {
      const page = await file(name);
      const type = imageType(name) ?? page.type;
      return page.type === type ? page : page.slice(0, page.size, type);
    };
    return {
      async list() {
        const files: FileEntry[] = [];
        for await (const [, child] of folder.entries())
          if (child.kind === 'file') files.push(child);
        return Promise.all(
          files.map(async (child) => ({ name: child.name, size: (await child.getFile()).size }))
        );
      },
      read,
      async head(name, bytes = HEAD_BYTES) {
        return new Uint8Array(await (await file(name)).slice(0, bytes).arrayBuffer());
      },
    };
  }

  const archive = await (entry as FileEntry).getFile();
  const directory = new Map<string, ZipEntry>();
  for (const item of await readZipDirectory(archive)) directory.set(item.name, item);
  const find = (name: string) => {
    const item = directory.get(name);
    if (!item) throw new Error(`${name} isn't in this archive`);
    return item;
  };
  return {
    async list() {
      return [...directory.values()].map(({ name, size }) => ({ name, size }));
    },
    read: (name) => zipEntryBlob(archive, find(name), imageType(name) ?? ''),
    head: (name, bytes = HEAD_BYTES) => readZipEntry(archive, find(name), { head: bytes }),
  };
}

/** A gallery's folder or archive file, found from its library folder */
export async function openGallery(engine: Engine, gallery: GallerySource) {
  const root = await engine.roots.get(gallery.rootId);
  if (!root) throw new FolderAccessError('Add this library folder again to read its doujins');
  const segments = relativeTo(gallery.rootPath, gallery.path);
  return findEntry(root, segments, gallery.kind === 'folder' ? 'directory' : 'file');
}

const opened = new Map<string, Promise<GalleryContents>>();
const MAX_OPEN = 32;

/** Galleries read most recently stay open, so turning pages doesn't find and list them again */
function contentsOf(engine: Engine, gallery: GallerySource) {
  const key = `${gallery.id}\0${gallery.fingerprint}`;
  let contents = opened.get(key);
  if (contents) {
    opened.delete(key);
  } else {
    contents = openGallery(engine, gallery).then((entry) => galleryContents(entry, gallery.kind));
    contents.catch(() => opened.delete(key));
  }
  opened.set(key, contents);
  if (opened.size > MAX_OPEN) opened.delete(opened.keys().next().value!);
  return contents;
}

/** Forgets galleries kept open, after a scan changed them or a folder was removed */
export function closeGalleries() {
  opened.clear();
}

/**
 * Runs `work` on a gallery's contents. A file that changed on disk since it was opened can no
 * longer be read from the old copy, so it's opened again once before giving up.
 */
async function withContents<T>(
  engine: Engine,
  gallery: GallerySource,
  work: (contents: GalleryContents) => Promise<T>
) {
  try {
    return await work(await contentsOf(engine, gallery));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotReadableError') throw error;
    opened.delete(`${gallery.id}\0${gallery.fingerprint}`);
    return work(await contentsOf(engine, gallery));
  }
}

/** A page for the reader */
export const readEntry = (engine: Engine, gallery: GallerySource, name: string) =>
  withContents(engine, gallery, (contents) => contents.read(name));

/** Enough of a page to read its image header */
export const readEntryHead = (engine: Engine, gallery: GallerySource, name: string) =>
  withContents(engine, gallery, (contents) => contents.head(name));
