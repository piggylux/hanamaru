import type { ReaderPrefs, SortKey } from '#lib/types.js';

import { closeGalleries, readEntry } from './archive/index.js';
import {
  BackupError,
  exportLibrary,
  forgetPendingImports,
  importLibrary,
  pendingImportCount,
} from './backup.js';
import type { Engine } from './context.js';
import { EngineError } from './errors.js';
import type { FolderEntry } from './files.js';
import { isScanning, latestScan, startScan } from './jobs.js';
import {
  addRoot,
  continueReading,
  createCollection,
  deleteCollection,
  gallerySource,
  getGallery,
  hasRoots,
  libraryStats,
  listCollections,
  listRoots,
  listTags,
  pageInfos,
  pageName,
  PAGE_SIZE,
  queryGalleries,
  renameCollection,
  resetProgress,
  saveProgress,
  setInCollection,
  updateGallery,
} from './library.js';
import { pruneTags, setManualMetadata } from './metadata/apply.js';
import { parseTag, uniqueTags } from './metadata/tags.js';
import { ensurePageSizes, pageThumbnail } from './pages.js';
import { isSortKey } from './search.js';
import { cleanReaderPrefs, getSetting, setSetting } from './settings.js';
import { coverPath, removeThumbnails } from './thumbs.js';

/** A Blob with its image type, which the service worker answers with */
const typed = (blob: Blob | undefined, type: string) =>
  !blob || blob.type === type || !type ? blob : blob.slice(0, blob.size, type);

type ListQuery = { query?: string; sort?: string; seed?: number };

const sortOf = (sort: string | undefined): SortKey => (sort && isSortKey(sort) ? sort : 'added');

function requireGallery(engine: Engine, id: number) {
  const gallery = getGallery(engine.db, id);
  if (!gallery) throw new EngineError('This doujin is not in the library', 'not-found');
  return gallery;
}

/**
 * Whether two folders are the same, or one is inside the other: both would list the same doujins.
 * A folder the browser won't compare this visit (its access not allowed yet) can't be checked.
 */
async function overlap(a: FolderEntry, b: FolderEntry) {
  const check = async (test: () => Promise<boolean>) => {
    try {
      return await test();
    } catch {
      return false;
    }
  };
  return (
    (await check(() => a.isSameEntry(b))) ||
    (await check(async () => (await a.resolve(b)) !== null)) ||
    (await check(async () => (await b.resolve(a)) !== null))
  );
}

const collectionName = (name: unknown) => {
  if (typeof name !== 'string' || !name.trim()) throw new EngineError('A collection needs a name');
  return name;
};

/** Forgets galleries and their thumbnails, after their folder was removed or they went missing */
async function forgetGalleries(engine: Engine, ids: number[], extra: () => void) {
  const { db } = engine;
  db.transaction(() => {
    for (const id of ids) db.query('DELETE FROM gallery_fts WHERE rowid = ?').run(id);
    extra();
    pruneTags(db);
  })();
  closeGalleries();
  await Promise.all(ids.map((id) => removeThumbnails(engine, id)));
}

/**
 * What the pages can ask the engine. Each takes the engine first; the page calls them without it
 * (see `client.ts`), and everything passed or returned is copied between the page and the worker.
 */
export const api = {
  ping: () => true,

  /** The library page: its first cards, and what the sidebar and "Continue reading" show */
  library(engine: Engine, { query = '', sort, seed = 0 }: ListQuery) {
    const { db } = engine;
    const { total, items } = queryGalleries(db, { query, sort: sortOf(sort), seed, limit: 60 });
    return {
      total,
      items,
      continueReading: query ? [] : continueReading(db),
      hasRoots: hasRoots(db),
      stats: libraryStats(db),
      collections: listCollections(db).map(({ id, name, count }) => ({ id, name, count })),
    };
  },

  /** More cards as the grid scrolls */
  galleries(
    engine: Engine,
    {
      query = '',
      sort,
      seed = 0,
      offset = 0,
      limit = PAGE_SIZE,
    }: ListQuery & {
      offset?: number;
      limit?: number;
    }
  ) {
    return queryGalleries(engine.db, {
      query,
      sort: sortOf(sort),
      seed,
      offset: Math.max(0, Math.floor(offset)),
      limit: Math.min(PAGE_SIZE, Math.max(1, Math.floor(limit))),
    });
  },

  /** Tags for the search box's suggestions, or the tags page */
  tags(engine: Engine, options: { prefix?: string; namespace?: string; limit?: number } = {}) {
    return listTags(engine.db, { ...options, limit: Math.min(5000, options.limit ?? 10) });
  },

  gallery(engine: Engine, id: number) {
    return {
      gallery: requireGallery(engine, id),
      collections: listCollections(engine.db).map(({ id, name }) => ({ id, name })),
    };
  },

  /** What the reader needs before the first page shows */
  reader(engine: Engine, id: number) {
    const gallery = requireGallery(engine, id);
    if (gallery.missing) throw new EngineError('This doujin is not available', 'not-found');
    return {
      gallery,
      prefs: { ...getSetting(engine.db, 'readerDefaults'), ...gallery.readerPrefs } as ReaderPrefs,
    };
  },

  /** Every page's size, measured the first time */
  async pageSizes(engine: Engine, id: number) {
    const source = gallerySource(engine.db, id);
    if (!source) return [];
    await ensurePageSizes(engine, source);
    return pageInfos(engine.db, id);
  },

  updateGallery(
    engine: Engine,
    id: number,
    update: {
      favorite?: boolean;
      rating?: number | null;
      readerPrefs?: Partial<ReaderPrefs> | null;
    }
  ) {
    requireGallery(engine, id);
    updateGallery(engine.db, id, {
      favorite: typeof update.favorite === 'boolean' ? update.favorite : undefined,
      rating:
        update.rating === null || typeof update.rating === 'number' ? update.rating : undefined,
      readerPrefs:
        update.readerPrefs === null || typeof update.readerPrefs === 'object'
          ? update.readerPrefs
          : undefined,
    });
    return getGallery(engine.db, id);
  },

  saveProgress(engine: Engine, id: number, page: number) {
    if (Number.isFinite(page)) saveProgress(engine.db, id, page);
  },

  resetProgress(engine: Engine, id: number) {
    resetProgress(engine.db, id);
  },

  /** Saves what was typed in the edit dialog: the title, and the full list of tags */
  setMetadata(
    engine: Engine,
    id: number,
    { title, titleJpn, tags }: { title: string; titleJpn?: string; tags: string[] }
  ) {
    requireGallery(engine, id);
    const clean = title.trim();
    if (!clean) throw new EngineError('A title is needed');
    setManualMetadata(engine.db, id, {
      title: clean,
      titleJpn: titleJpn?.trim() || undefined,
      tags: uniqueTags(tags.map((tag) => parseTag(tag))),
    });
    return getGallery(engine.db, id);
  },

  setInCollection(engine: Engine, galleryId: number, collectionId: number, inside: boolean) {
    setInCollection(engine.db, collectionId, galleryId, inside);
    return getGallery(engine.db, galleryId)?.collections ?? [];
  },

  collections: (engine: Engine) => listCollections(engine.db),

  createCollection(engine: Engine, name: string) {
    try {
      return createCollection(engine.db, collectionName(name));
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError('There is already a collection with that name');
    }
  },

  renameCollection(engine: Engine, id: number, name: string) {
    try {
      renameCollection(engine.db, id, collectionName(name));
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError('There is already a collection with that name');
    }
  },

  deleteCollection(engine: Engine, id: number) {
    deleteCollection(engine.db, id);
  },

  settings(engine: Engine) {
    const { db } = engine;
    return {
      roots: listRoots(db),
      stats: libraryStats(db),
      readerDefaults: getSetting(db, 'readerDefaults'),
      pendingImports: pendingImportCount(db),
      scan: latestScan(),
    };
  },

  setReaderDefaults(engine: Engine, prefs: unknown) {
    setSetting(engine.db, 'readerDefaults', cleanReaderPrefs(prefs));
  },

  /** Adds a folder picked in the browser, then scans it */
  async addRoot(engine: Engine, folder: FolderEntry) {
    for (const root of listRoots(engine.db)) {
      const existing = await engine.roots.get(root.id);
      if (existing && (await overlap(existing, folder))) {
        throw new EngineError(`That folder overlaps ${root.path}, which is already in the library`);
      }
    }
    const id = addRoot(engine.db, folder.name);
    await engine.roots.set(id, folder);
    void startScan(engine);
    return listRoots(engine.db);
  },

  /** Takes a folder out of the library: hanamaru forgets its doujins, and its files stay as they are */
  async removeRoot(engine: Engine, id: number) {
    // A running scan would go on adding doujins to the folder being removed
    if (isScanning()) throw new EngineError('Wait for the scan to finish, then remove the folder');
    const galleries = engine.db
      .query<{ id: number }, [number]>('SELECT id FROM gallery WHERE root_id = ?')
      .all(id)
      .map((row) => row.id);
    await forgetGalleries(engine, galleries, () =>
      engine.db.query('DELETE FROM library_root WHERE id = ?').run(id)
    );
    await engine.roots.delete(id);
    engine.emit({ type: 'library' });
    return listRoots(engine.db);
  },

  scan(engine: Engine) {
    void startScan(engine);
  },

  latestScan: () => latestScan(),

  /** Forgets doujins that are no longer in their folders, with their tags and progress */
  async removeMissing(engine: Engine) {
    const missing = engine.db
      .query<{ id: number }, []>('SELECT id FROM gallery WHERE missing = 1')
      .all()
      .map((row) => row.id);
    await forgetGalleries(engine, missing, () => {
      for (const id of missing) engine.db.query('DELETE FROM gallery WHERE id = ?').run(id);
    });
    engine.emit({ type: 'library' });
    return missing.length;
  },

  exportBackup: (engine: Engine) => exportLibrary(engine.db),

  importBackup(engine: Engine, data: unknown) {
    try {
      const result = importLibrary(engine.db, data);
      engine.emit({ type: 'library' });
      return result;
    } catch (error) {
      if (error instanceof BackupError) throw new EngineError(error.message);
      throw error;
    }
  },

  /** Stops waiting for imported doujins that were never found */
  forgetPendingImports: (engine: Engine) => forgetPendingImports(engine.db),

  /**
   * An image for `/media/...`, which the service worker asks for on the page's behalf: a cover,
   * a page's thumbnail, or a page itself. Undefined when there's none.
   */
  async media(engine: Engine, url: string) {
    const match = /^\/media\/(cover|thumb|page)\/(\d+)(?:\/(\d+))?(?:\?|$)/.exec(url);
    if (!match) return undefined;
    const [, kind, idText, indexText] = match;
    const id = Number(idText);
    if (kind === 'cover') return typed(await engine.store.read(coverPath(id)), 'image/webp');
    const source = gallerySource(engine.db, id);
    const index = Number(indexText);
    if (!source || !Number.isInteger(index)) return undefined;
    if (kind === 'thumb') return typed(await pageThumbnail(engine, source, index), 'image/webp');
    const name = pageName(engine.db, id, index);
    if (!name) return undefined;
    // Pages come typed from their folder or archive
    return readEntry(engine, source, name);
  },
};

export type Api = typeof api;
