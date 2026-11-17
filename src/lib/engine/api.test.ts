import { beforeEach, describe, expect, it } from 'bun:test';

import { zipSync } from 'fflate';

import { api } from './api.js';
import { startScan } from './jobs.js';
import { MemoryFolder, testEngine, testImage, type TestEngine } from './test-helpers.js';
import { coverPath } from './thumbs.js';

let engine: TestEngine;
let root: MemoryFolder;

beforeEach(() => {
  engine = testEngine();
  root = new MemoryFolder('Doujin');
  root.write('[Artist] Folder Book/1.jpg', testImage(60, 90, 10));
  root.write('[Artist] Folder Book/2.jpg', testImage(60, 90, 20));
  root.write('Zips/Zip Book.cbz', zipSync({ 'a.png': [testImage(120, 90), { level: 0 }] }));
});

/** Adds the library folder and waits for the scan it starts */
async function added(folder = root) {
  const roots = await api.addRoot(engine, folder);
  await startScan(engine);
  return roots;
}

const idOf = (title: string) =>
  engine.db.query<{ id: number }, [string]>('SELECT id FROM gallery WHERE title = ?').get(title)!
    .id;

describe('addRoot', () => {
  it('adds a folder under its name and scans it', async () => {
    expect(api.library(engine, {}).hasRoots).toBe(false);
    expect((await added()).map((folder) => folder.path)).toEqual(['Doujin']);
    expect(api.library(engine, {})).toMatchObject({ hasRoots: true, total: 2 });
  });

  it('refuses the same folder, a folder inside it, or one around it', async () => {
    await added();
    const parent = new MemoryFolder('Pictures');
    parent.children.set('Doujin', root);
    for (const folder of [root, root.folder('Zips'), parent]) {
      await expect(api.addRoot(engine, folder)).rejects.toThrow('overlaps Doujin');
    }
  });

  it("still adds a folder when another one can't be compared yet", async () => {
    await added();
    root.isSameEntry = async () => {
      throw new DOMException('Not allowed yet', 'NotAllowedError');
    };
    root.resolve = root.isSameEntry as never;
    const other = new MemoryFolder('Doujin');
    other.write('Another/1.jpg', testImage());
    // Same name as the first folder: its doujins' paths stay apart
    expect((await api.addRoot(engine, other)).map((folder) => folder.path)).toEqual([
      'Doujin',
      'Doujin (2)',
    ]);
    // Adding started a scan; one scan runs at a time, so the next test waits for its own
    await startScan(engine);
  });
});

describe('removeRoot', () => {
  it('forgets its doujins and their thumbnails, and leaves the files alone', async () => {
    const [folder] = await added();
    const id = idOf('Folder Book');
    expect(engine.store.files.has(coverPath(id))).toBe(true);

    expect(await api.removeRoot(engine, folder.id)).toEqual([]);
    expect(api.library(engine, {})).toMatchObject({ hasRoots: false, total: 0 });
    expect(engine.store.files.size).toBe(0);
    expect(await engine.roots.get(folder.id)).toBeUndefined();
    expect(root.children.size).toBe(2);
  });
});

describe('media', () => {
  it('answers covers, page thumbnails and pages, each with its image type', async () => {
    await added();
    const book = idOf('Folder Book');
    const zip = idOf('Zip Book');
    const cover = await api.media(engine, `/media/cover/${book}?v=abc`);
    expect(cover?.type).toBe('image/webp');
    const page = await api.media(engine, `/media/page/${book}/1?v=abc`);
    expect(page?.type).toBe('image/jpeg');
    expect(page?.size).toBe(testImage().length);
    expect((await api.media(engine, `/media/page/${zip}/0`))?.type).toBe('image/png');
    expect((await api.media(engine, `/media/thumb/${book}/0`))?.type).toBe('image/webp');
  });

  it('answers nothing for addresses it does not know', async () => {
    await added();
    const book = idOf('Folder Book');
    for (const url of [
      '/media/cover/999',
      `/media/page/${book}/9`,
      `/media/page/${book}`,
      `/media/other/${book}/0`,
      `/media/page/${book}/0/../1`,
    ]) {
      expect(await api.media(engine, url)).toBeUndefined();
    }
  });
});
