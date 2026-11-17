import { Database as BunDatabase } from 'bun:sqlite';

import type { AppEvent } from '#lib/types.js';

import type { Engine, ImageCodec } from './context.js';
import { prepareDatabase, type Database } from './db.js';
import type { BlobStore, FileEntry, FolderEntry, RootStore } from './files.js';
import { imageSize } from './image-size.js';

/** An in-memory database on Bun's SQLite, behind the same interface the browser's uses */
export function openTestDatabase(): Database {
  const db = new BunDatabase(':memory:', { strict: true });
  return prepareDatabase({
    query: (sql) => db.query(sql) as never,
    run: (sql) => void db.run(sql),
    transaction: (work) => db.transaction(work),
    close: () => db.close(),
  });
}

/**
 * The start of a PNG of the given size: enough for hanamaru to read its size and treat it as a
 * page. `shade` makes otherwise identical pages differ, as different pages would.
 */
export function testImage(width = 60, height = 90, shade = 200) {
  const bytes = new Uint8Array(33 + 4);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 2, 0, 0, 0], 24);
  bytes[33] = shade;
  return bytes;
}

/** Stands in for the canvas: a thumbnail is a small Blob, and sizes come from image headers */
export const testCodec: ImageCodec = {
  async thumbnail(input, width) {
    if (!input.size) return undefined;
    return new Blob([`thumbnail ${width}px of ${input.size} bytes`], { type: 'image/webp' });
  },
  async size(input) {
    return imageSize(new Uint8Array(await input.arrayBuffer()));
  },
};

/** A file in a test library, behaving like the browser's file handle */
export class MemoryFile implements FileEntry {
  readonly kind = 'file';
  data: Uint8Array<ArrayBuffer>;

  constructor(
    public name: string,
    data: Uint8Array,
    public lastModified = Date.now()
  ) {
    this.data = new Uint8Array(data);
  }

  async getFile() {
    return new File([this.data], this.name, { lastModified: this.lastModified });
  }
}

/** A folder in a test library, with helpers to change it between scans */
export class MemoryFolder implements FolderEntry {
  readonly kind = 'directory';
  children = new Map<string, MemoryFile | MemoryFolder>();
  /** Set to make reading this folder fail as if the browser withdrew permission */
  denied = false;

  constructor(public name: string) {}

  async *entries(): AsyncIterable<[string, MemoryFile | MemoryFolder]> {
    if (this.denied) throw new DOMException('Permission withdrawn', 'NotAllowedError');
    for (const entry of this.children) yield entry;
  }

  async getDirectoryHandle(name: string) {
    const child = this.children.get(name);
    if (!(child instanceof MemoryFolder)) throw new DOMException(name, 'NotFoundError');
    return child;
  }

  async getFileHandle(name: string) {
    const child = this.children.get(name);
    if (!(child instanceof MemoryFile)) throw new DOMException(name, 'NotFoundError');
    return child;
  }

  async isSameEntry(other: FileEntry | FolderEntry) {
    return other === this;
  }

  async resolve(other: FileEntry | FolderEntry): Promise<string[] | null> {
    for (const [name, child] of this.children) {
      if (child === other) return [name];
      if (child instanceof MemoryFolder) {
        const inside = await child.resolve(other);
        if (inside) return [name, ...inside];
      }
    }
    return null;
  }

  /** The folder at a slash-separated path, made on the way if needed */
  folder(path: string): MemoryFolder {
    return path
      .split('/')
      .filter(Boolean)
      .reduce<MemoryFolder>((folder, name) => {
        let child = folder.children.get(name);
        if (!(child instanceof MemoryFolder)) {
          child = new MemoryFolder(name);
          folder.children.set(name, child);
        }
        return child;
      }, this);
  }

  write(path: string, data: Uint8Array | string) {
    const at = path.lastIndexOf('/');
    const folder = at < 0 ? this : this.folder(path.slice(0, at));
    const name = path.slice(at + 1);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    folder.children.set(name, new MemoryFile(name, bytes));
  }

  /** Moves a file or folder, as renaming it in Explorer would */
  move(from: string, to: string) {
    const take = (path: string) => {
      const at = path.lastIndexOf('/');
      return { parent: at < 0 ? this : this.folder(path.slice(0, at)), name: path.slice(at + 1) };
    };
    const source = take(from);
    const entry = source.parent.children.get(source.name);
    if (!entry) throw new Error(`${from} doesn't exist`);
    source.parent.children.delete(source.name);
    const target = take(to);
    entry.name = target.name;
    target.parent.children.set(target.name, entry);
  }
}

/** The site's private storage, in memory */
export class MemoryStore implements BlobStore {
  files = new Map<string, Blob>();

  async read(path: string) {
    return this.files.get(path);
  }

  async write(path: string, data: Blob) {
    this.files.set(path, data);
  }

  async remove(path: string) {
    for (const key of this.files.keys()) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }
}

export class MemoryRoots implements RootStore {
  folders = new Map<number, FolderEntry>();

  async get(id: number) {
    return this.folders.get(id);
  }

  async set(id: number, folder: FolderEntry) {
    this.folders.set(id, folder);
  }

  async delete(id: number) {
    this.folders.delete(id);
  }
}

export type TestEngine = Engine & {
  roots: MemoryRoots;
  store: MemoryStore;
  events: AppEvent[];
};

/** An engine with its own database, storage and library folders, all in memory */
export function testEngine(): TestEngine {
  const events: AppEvent[] = [];
  return {
    db: openTestDatabase(),
    roots: new MemoryRoots(),
    store: new MemoryStore(),
    images: testCodec,
    emit: (event) => events.push(event),
    events,
  };
}
