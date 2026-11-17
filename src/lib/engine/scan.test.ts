import { beforeEach, describe, expect, it } from 'bun:test';

import { zipSync } from 'fflate';

import { readEntry } from './archive/index.js';
import { addRoot, gallerySource } from './library.js';
import { ensurePageSizes } from './pages.js';
import { fingerprintOf, hashNames, scanLibrary } from './scan.js';
import { MemoryFolder, testEngine, testImage, type TestEngine } from './test-helpers.js';
import { coverPath } from './thumbs.js';

let engine: TestEngine;
let root: MemoryFolder;

beforeEach(async () => {
  engine = testEngine();
  root = new MemoryFolder('Doujin');
  await engine.roots.set(addRoot(engine.db, root.name), root);
});

const galleries = () =>
  engine.db
    .query<
      {
        id: number;
        path: string;
        title: string;
        page_count: number;
        missing: number;
        favorite: number;
      },
      []
    >('SELECT id, path, title, page_count, missing, favorite FROM gallery ORDER BY path')
    .all();

const tagsOf = (id: number) =>
  engine.db
    .query<{ tag: string }, [number]>(
      `SELECT DISTINCT t.namespace || ':' || t.name AS tag FROM gallery_tag gt JOIN tag t ON t.id = gt.tag_id
       WHERE gt.gallery_id = ? ORDER BY tag`
    )
    .all(id)
    .map((row) => row.tag);

function makeFolderGallery(name: string) {
  root.write(`${name}/10.jpg`, testImage(60, 90, 30));
  root.write(`${name}/2.jpg`, testImage(60, 90, 20));
  root.write(`${name}/1.jpg`, testImage(60, 90, 10));
  root.write(`${name}/Thumbs.db`, 'not a page');
}

function makeZipGallery(name: string) {
  const comicInfo = `<ComicInfo><Tags>female:glasses</Tags></ComicInfo>`;
  root.write(
    name,
    zipSync({
      'p01.jpg': [testImage(120, 90), { level: 0 }],
      'p02.jpg': [testImage(), { level: 0 }],
      'ComicInfo.xml': new TextEncoder().encode(comicInfo),
    })
  );
}

describe('scanLibrary', () => {
  it('finds folders and archives, with their pages in reading order', async () => {
    makeFolderGallery('Plain Folder');
    makeZipGallery('(C99) [Circle (Artist)] Zipped Title (Blue Archive) [English].cbz');
    root.folder('empty folder');

    const result = await scanLibrary(engine);
    expect(result.added).toBe(2);
    expect(result.errors).toEqual([]);

    const folder = galleries().find((gallery) => gallery.path.endsWith('Plain Folder'))!;
    const zip = galleries().find((gallery) => gallery.path.endsWith('.cbz'))!;
    // Paths start with the library folder's name, and use forward slashes
    expect(folder.path).toBe('Doujin/Plain Folder');
    expect(folder.title).toBe('Plain Folder');
    expect(folder.page_count).toBe(3);
    const pages = engine.db
      .query<{ name: string }, [number]>('SELECT name FROM page WHERE gallery_id = ? ORDER BY idx')
      .all(folder.id)
      .map((page) => page.name);
    expect(pages).toEqual(['1.jpg', '2.jpg', '10.jpg']);

    expect(zip.title).toBe('Zipped Title');
    expect(zip.page_count).toBe(2);
    expect(tagsOf(zip.id)).toEqual([
      'artist:artist',
      'event:c99',
      'female:glasses',
      'group:circle',
      'language:english',
      'language:translated',
      'parody:blue archive',
    ]);
    expect(engine.store.files.has(coverPath(folder.id))).toBe(true);
    expect(engine.store.files.has(coverPath(zip.id))).toBe(true);
  });

  it('reads pages and their sizes back from folders and archives', async () => {
    makeFolderGallery('Plain Folder');
    makeZipGallery('Zipped.cbz');
    await scanLibrary(engine);
    for (const gallery of galleries()) {
      const source = gallerySource(engine.db, gallery.id)!;
      const name = gallery.path.endsWith('.cbz') ? 'p01.jpg' : '1.jpg';
      const page = await readEntry(engine, source, name);
      expect(page.size).toBe(testImage().length);
      expect(page.type).toBe('image/jpeg');
      await ensurePageSizes(engine, source);
    }
    const zip = galleries().find((gallery) => gallery.path.endsWith('.cbz'))!;
    const sizes = engine.db
      .query<{ width: number; height: number }, [number]>(
        'SELECT width, height FROM page WHERE gallery_id = ? ORDER BY idx'
      )
      .all(zip.id);
    expect(sizes).toEqual([
      { width: 120, height: 90 },
      { width: 60, height: 90 },
    ]);
  });

  it('counts RAR and 7z archives without opening them', async () => {
    root.write('Packed.cbr', 'rar bytes');
    root.write('sub/Other.7z', '7z bytes');
    const result = await scanLibrary(engine);
    expect(result.unsupported).toBe(2);
    expect(galleries()).toEqual([]);
  });

  it('skips what has not changed', async () => {
    makeFolderGallery('Plain Folder');
    await scanLibrary(engine);
    const again = await scanLibrary(engine);
    expect(again.total).toBe(0);
    expect(again.added + again.updated).toBe(0);
  });

  it('keeps progress and favorites when a doujin is renamed or moved', async () => {
    makeZipGallery('Old Name.cbz');
    await scanLibrary(engine);
    const [before] = galleries();
    engine.db.query('UPDATE gallery SET favorite = 1, last_page = 1 WHERE id = ?').run(before.id);

    root.move('Old Name.cbz', 'sorted/New Name.cbz');
    const result = await scanLibrary(engine);

    expect(result.moved).toBe(1);
    expect(result.added).toBe(0);
    const [after] = galleries();
    expect(after.id).toBe(before.id);
    expect(after.path).toBe('Doujin/sorted/New Name.cbz');
    expect(after.favorite).toBe(1);
  });

  it('marks doujins that disappeared as missing, and finds them again', async () => {
    makeFolderGallery('Going Away');
    await scanLibrary(engine);
    const away = root.children.get('Going Away')!;
    root.children.delete('Going Away');

    expect((await scanLibrary(engine)).missing).toBe(1);
    expect(galleries()[0].missing).toBe(1);

    root.children.set('Going Away', away);
    await scanLibrary(engine);
    expect(galleries()[0].missing).toBe(0);
  });

  it('notices pages added to a folder', async () => {
    makeFolderGallery('Growing');
    await scanLibrary(engine);
    root.write('Growing/11.jpg', testImage());
    const result = await scanLibrary(engine);
    expect(result.updated).toBe(1);
    expect(galleries()[0].page_count).toBe(4);
  });

  it("leaves a folder's doujins alone when the browser no longer allows reading it", async () => {
    makeFolderGallery('Kept');
    await scanLibrary(engine);
    root.denied = true;
    const result = await scanLibrary(engine);
    expect(result.errors).toEqual(['Doujin: allow access to this folder, then scan again']);
    expect(result.missing).toBe(0);
    expect(galleries()[0].missing).toBe(0);
  });
});

describe('fingerprintOf', () => {
  it('matches the server version, so its backups find the same doujins', async () => {
    // SHA-1 of "1.jpg\0100\n2.jpg\0200\n", as Node's createHash computed it
    expect(
      await fingerprintOf([
        { name: '1.jpg', size: 100 },
        { name: '2.jpg', size: 200 },
      ])
    ).toBe('411c81012af2dd7520666f1846d934040b75a064');
  });
});

describe('hashNames', () => {
  it('changes when a page is renamed, and not when the order is the same', () => {
    expect(hashNames(['1.jpg', '2.jpg'])).toBe(hashNames(['1.jpg', '2.jpg']));
    expect(hashNames(['1.jpg', '2.jpg'])).not.toBe(hashNames(['1.jpg', '3.jpg']));
    expect(hashNames(['ab', 'c'])).not.toBe(hashNames(['a', 'bc']));
  });
});
