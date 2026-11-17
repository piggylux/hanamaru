/**
 * The library folders, as the File System Access API hands them out. Only the parts hanamaru uses
 * are listed, so tests can stand in for them with plain objects. Handles are opened for reading
 * only: nothing here can write to the library.
 */
export interface FileEntry {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

export interface FolderEntry {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterable<[string, FileEntry | FolderEntry]>;
  getDirectoryHandle(name: string): Promise<FolderEntry>;
  getFileHandle(name: string): Promise<FileEntry>;
  isSameEntry(other: FileEntry | FolderEntry): Promise<boolean>;
  /** The names leading from this folder down to `other`, or null when it isn't inside */
  resolve(other: FileEntry | FolderEntry): Promise<string[] | null>;
}

/** Where each library folder's handle is kept between visits: IndexedDB, or a Map in tests */
export interface RootStore {
  get(id: number): Promise<FolderEntry | undefined>;
  set(id: number, folder: FolderEntry): Promise<void>;
  delete(id: number): Promise<void>;
}

/** hanamaru's own files, such as thumbnails: the site's private storage, or a Map in tests */
export interface BlobStore {
  read(path: string): Promise<Blob | undefined>;
  write(path: string, data: Blob): Promise<void>;
  /** Removes a file, or a folder with everything in it */
  remove(path: string): Promise<void>;
}

/** Paths in the database use forward slashes, starting with the library folder's name */
export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/');

export const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A gallery's place inside its library folder, from its stored path */
export function relativeTo(rootPath: string, path: string) {
  if (path === rootPath) return [];
  const inside = path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path;
  return inside.split('/').filter(Boolean);
}

/** The folder or file at `segments` inside `root` */
export async function findEntry(
  root: FolderEntry,
  segments: string[],
  kind: 'file' | 'directory'
): Promise<FileEntry | FolderEntry> {
  let folder = root;
  for (const [index, name] of segments.entries()) {
    const last = index === segments.length - 1;
    if (last && kind === 'file') return folder.getFileHandle(name);
    folder = await folder.getDirectoryHandle(name);
  }
  return folder;
}

/** Thrown when a library folder's handle is missing or the browser no longer allows reading it */
export class FolderAccessError extends Error {
  readonly code = 'folder-access';
}

/** Whether an error means the browser needs permission again, rather than a missing file */
export function isAccessError(error: unknown) {
  return (
    error instanceof FolderAccessError ||
    (error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'SecurityError'))
  );
}
