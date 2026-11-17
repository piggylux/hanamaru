import { describe, expect, it } from 'bun:test';

import { zipSync } from 'fflate';

import {
  BackupError,
  exportLibrary,
  importLibrary,
  pendingImportCount,
  type LibraryBackup,
} from './backup.js';
import {
  addRoot,
  createCollection,
  getGallery,
  listRoots,
  saveProgress,
  setInCollection,
} from './library.js';
import { setManualMetadata } from './metadata/apply.js';
import { scanLibrary } from './scan.js';
import { getSetting, setSetting } from './settings.js';
import { MemoryFolder, testEngine, testImage, type TestEngine } from './test-helpers.js';

/** A library folder with one folder doujin and one ZIP doujin */
function makeLibrary(name = 'library') {
  const root = new MemoryFolder(name);
  root.write('[Artist] Folder Book/1.jpg', testImage(60, 90, 10));
  root.write('[Artist] Folder Book/2.jpg', testImage(60, 90, 20));
  root.write('[Artist] Folder Book/3.jpg', testImage(60, 90, 30));
  root.write(
    '[Circle (Other)] Zip Book [English].cbz',
    zipSync({
      'a.jpg': [testImage(), { level: 0 }],
      'b.jpg': [testImage(), { level: 0 }],
    })
  );
  return root;
}

async function scannedLibrary(engine: TestEngine, root: MemoryFolder) {
  await engine.roots.set(addRoot(engine.db, root.name), root);
  await scanLibrary(engine);
}

const byTitle = (engine: TestEngine, title: string) => {
  const row = engine.db
    .query<{ id: number }, [string]>('SELECT id FROM gallery WHERE title = ?')
    .get(title);
  return row ? getGallery(engine.db, row.id) : undefined;
};

/** The library A started with, read and organized, then exported */
async function organizedBackup() {
  const ctx = testEngine();
  await scannedLibrary(ctx, makeLibrary());

  const folderBook = byTitle(ctx, 'Folder Book')!;
  const zipBook = byTitle(ctx, 'Zip Book')!;
  ctx.db.query('UPDATE gallery SET favorite = 1, rating = 4 WHERE id = ?').run(folderBook.id);
  saveProgress(ctx.db, folderBook.id, 1);
  setManualMetadata(ctx.db, zipBook.id, {
    title: 'Renamed By Hand',
    tags: [{ namespace: 'female', name: 'glasses' }],
  });
  setInCollection(ctx.db, createCollection(ctx.db, 'Favourites'), folderBook.id, true);
  setSetting(ctx.db, 'readerDefaults', {
    mode: 'double',
    direction: 'ltr',
    fit: 'width',
    shift: false,
  });

  const backup = exportLibrary(ctx.db);
  return { backup };
}

describe('exportLibrary', () => {
  it('saves details, collections and reader settings', async () => {
    const { backup } = await organizedBackup();
    expect(backup.format).toBe('hanamaru-library');
    expect(backup.galleries).toHaveLength(2);
    const folderBook = backup.galleries.find((gallery) => gallery.title === 'Folder Book')!;
    expect(folderBook.favorite).toBe(true);
    expect(folderBook.rating).toBe(4);
    expect(folderBook.lastPage).toBe(1);
    expect(folderBook.collections).toEqual(['Favourites']);
    expect(folderBook.tags).toContainEqual({
      namespace: 'artist',
      name: 'artist',
      source: 'filename',
    });
    expect(backup.settings.readerDefaults.mode).toBe('double');
    expect(backup.roots).toEqual(['library']);
  });
});

describe('importLibrary', () => {
  it('restores doujins that moved to another folder, by their pages', async () => {
    const { backup } = await organizedBackup();
    const ctx = testEngine();
    await scannedLibrary(ctx, makeLibrary('moved library'));

    const result = importLibrary(ctx.db, backup);
    expect(result).toEqual({ restored: 2, waiting: 0, skipped: 0, collections: 1 });

    const folderBook = byTitle(ctx, 'Folder Book')!;
    expect(folderBook.favorite).toBe(true);
    expect(folderBook.rating).toBe(4);
    expect(folderBook.lastPage).toBe(1);
    expect(folderBook.collections.map((collection) => collection.name)).toEqual(['Favourites']);

    const zipBook = byTitle(ctx, 'Renamed By Hand')!;
    expect(zipBook.titleSource).toBe('manual');
    expect(zipBook.tags).toEqual([{ namespace: 'female', name: 'glasses' }]);
    expect(getSetting(ctx.db, 'readerDefaults').mode).toBe('double');
  });

  it('waits for doujins that are not in the library yet, and restores them after a scan', async () => {
    const { backup } = await organizedBackup();
    const ctx = testEngine();

    const result = importLibrary(ctx.db, backup);
    expect(result.waiting).toBe(2);
    expect(pendingImportCount(ctx.db)).toBe(2);

    await scannedLibrary(ctx, makeLibrary('found later'));
    expect(pendingImportCount(ctx.db)).toBe(0);
    expect(byTitle(ctx, 'Folder Book')!.favorite).toBe(true);
    expect(byTitle(ctx, 'Renamed By Hand')).toBeDefined();
  });

  it('leaves library folders to be added by hand', async () => {
    const { backup } = await organizedBackup();
    const ctx = testEngine();
    const result = importLibrary(ctx.db, backup);
    expect(listRoots(ctx.db)).toEqual([]);
    expect(result.waiting).toBe(2);
  });

  it('restores doujins from a backup of the server version, by their pages', async () => {
    const { backup } = await organizedBackup();
    // The server version stored full Windows paths, which the browser never sees
    for (const gallery of backup.galleries) gallery.path = `G:\\Doujin\\${gallery.title}`;
    const ctx = testEngine();
    await scannedLibrary(ctx, makeLibrary('Doujin'));
    expect(importLibrary(ctx.db, backup).restored).toBe(2);
    expect(byTitle(ctx, 'Folder Book')!.favorite).toBe(true);
  });

  it('keeps progress made after the backup', async () => {
    const { backup } = await organizedBackup();
    const ctx = testEngine();
    await scannedLibrary(ctx, makeLibrary());
    const folderBook = byTitle(ctx, 'Folder Book')!;
    // Read further after the backup was made
    await Bun.sleep(5);
    saveProgress(ctx.db, folderBook.id, 2);

    importLibrary(ctx.db, backup);
    const after = getGallery(ctx.db, folderBook.id)!;
    expect(after.lastPage).toBe(2);
    expect(after.readCount).toBe(1);
  });

  it('merges a backup twice without adding anything twice', async () => {
    const { backup } = await organizedBackup();
    const ctx = testEngine();
    await scannedLibrary(ctx, makeLibrary());
    importLibrary(ctx.db, backup);
    const second = importLibrary(ctx.db, backup);
    expect(second.collections).toBe(0);
    expect(byTitle(ctx, 'Folder Book')!.collections).toHaveLength(1);
  });

  it('refuses files that are not backups', async () => {
    const ctx = testEngine();
    expect(() => importLibrary(ctx.db, { hello: 'world' })).toThrow(BackupError);
    expect(() =>
      importLibrary(ctx.db, { format: 'hanamaru-library', version: 99, galleries: [] })
    ).toThrow('newer version');
  });

  it('skips entries it cannot read', async () => {
    const ctx = testEngine();
    const backup = {
      format: 'hanamaru-library',
      version: 1,
      galleries: [{ path: 42 }, null, { fingerprint: 'x', path: 'C:\\a', kind: 'zip' }],
    } as unknown as LibraryBackup;
    const result = importLibrary(ctx.db, backup);
    expect(result.skipped).toBe(2);
    expect(result.waiting).toBe(1);
  });
});
