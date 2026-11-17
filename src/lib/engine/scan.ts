import type { ScanProgress } from '#lib/types.js';

import {
  closeGalleries,
  galleryContents,
  type ArchiveEntry,
  type GalleryContents,
} from './archive/index.js';
import { applyPendingImports } from './backup.js';
import type { Engine } from './context.js';
import { isAccessError, joinPath, lastSegment, type FileEntry, type FolderEntry } from './files.js';
import {
  archiveKind,
  extname,
  isPage,
  isUnsupportedArchive,
  naturalCompare,
  type GalleryKind,
} from './images.js';
import { applyMetadata, pruneTags, reindex } from './metadata/apply.js';
import { parseFilename } from './metadata/filename.js';
import { combineSidecars, isSidecar, parseSidecar } from './metadata/sidecar.js';
import type { Metadata } from './metadata/tags.js';
import { COVER_WIDTH, coverPath, removeThumbnails, writeThumbnail } from './thumbs.js';

/** A doujin found in a library folder: a ZIP archive, or a folder with pages directly inside it */
type Found = {
  rootId: number;
  path: string;
  kind: GalleryKind;
  entry: FolderEntry | FileEntry;
  size: number;
  /**
   * For archives, when the file last changed. Browsers don't say when a folder changed, so for
   * folders this is a hash of their page names instead: adding, removing or renaming a page
   * changes it.
   */
  mtime: number;
  /** For folders, how many pages the walk saw */
  imageCount?: number;
  /** Sidecar files next to an archive, such as `Title.json` beside `Title.cbz` */
  siblings: FileEntry[];
};

type Known = {
  id: number;
  root_id: number;
  path: string;
  kind: GalleryKind;
  size: number;
  mtime: number;
  page_count: number;
  fingerprint: string;
  missing: number;
};

/** Folders Windows and other tools keep for themselves */
const SKIPPED_FOLDERS = /^(\$recycle\.bin|system volume information|__macosx|\..*)$/i;

const PARALLEL = 4;

/**
 * Brings the library in step with its folders. Doujins that haven't changed are skipped, so a
 * rescan only reads what's new. A doujin that was moved or renamed outside hanamaru is recognised
 * by its pages and keeps its tags and reading progress; one that's gone is marked missing, never
 * deleted. A library folder the browser won't let hanamaru read is left as it was.
 */
export async function scanLibrary(
  engine: Engine,
  onProgress: (progress: ScanProgress) => void = () => {}
): Promise<ScanProgress> {
  const { db } = engine;
  const progress: ScanProgress = {
    running: true,
    phase: 'walking',
    done: 0,
    total: 0,
    added: 0,
    updated: 0,
    moved: 0,
    missing: 0,
    unsupported: 0,
    errors: [],
  };
  let lastReport = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (force || now - lastReport > 250) {
      lastReport = now;
      onProgress({ ...progress, errors: [...progress.errors] });
    }
  };
  report(true);

  const roots = db
    .query<{ id: number; path: string }, []>('SELECT id, path FROM library_root')
    .all();
  const found: Found[] = [];
  const scannedRoots = new Set<number>();
  for (const root of roots) {
    progress.current = root.path;
    report();
    const folder = await engine.roots.get(root.id);
    if (!folder) {
      progress.errors.push(`${root.path}: add this folder again to scan it`);
      continue;
    }
    const before = found.length;
    try {
      await walk(root.id, folder, root.path, found, progress);
      scannedRoots.add(root.id);
    } catch (error) {
      // Without access, nothing in it was seen: none of it is marked missing
      found.length = before;
      progress.errors.push(
        isAccessError(error)
          ? `${root.path}: allow access to this folder, then scan again`
          : `${root.path}: ${(error as Error).message}`
      );
    }
  }

  const known = new Map(
    db
      .query<Known, []>(
        'SELECT id, root_id, path, kind, size, mtime, page_count, fingerprint, missing FROM gallery'
      )
      .all()
      .map((row) => [row.path, row])
  );
  const seen = new Set<string>();
  const work: { item: Found; existing?: Known }[] = [];

  for (const item of found) {
    seen.add(item.path);
    const existing = known.get(item.path);
    if (existing && isUnchanged(existing, item)) {
      if (existing.missing || existing.root_id !== item.rootId) {
        db.query('UPDATE gallery SET missing = 0, root_id = ? WHERE id = ?').run(
          item.rootId,
          existing.id
        );
      }
      continue;
    }
    work.push({ item, existing });
  }

  // Galleries that disappeared, plus ones already missing, are where moved doujins came from
  const movedFrom = new Map<string, Known[]>();
  for (const row of known.values()) {
    const vanished = !seen.has(row.path) && scannedRoots.has(row.root_id);
    if ((vanished || row.missing) && !seen.has(row.path)) {
      const list = movedFrom.get(row.fingerprint) ?? [];
      list.push(row);
      movedFrom.set(row.fingerprint, list);
    }
  }

  progress.phase = 'processing';
  progress.total = work.length;
  report(true);

  await forEachLimit(work, PARALLEL, async ({ item, existing }) => {
    progress.current = item.path;
    try {
      await processGallery(engine, item, existing, movedFrom, progress);
    } catch (error) {
      progress.errors.push(`${item.path}: ${(error as Error).message}`);
    }
    progress.done++;
    report();
  });

  // What's left wasn't found anywhere: keep it, marked missing, in case it comes back
  const markMissing = db.query('UPDATE gallery SET missing = 1 WHERE id = ? AND missing = 0');
  for (const rows of movedFrom.values()) {
    for (const row of rows) {
      if (!seen.has(row.path) && scannedRoots.has(row.root_id) && !row.missing) {
        if (markMissing.run(row.id).changes) progress.missing++;
      }
    }
  }
  // Doujins from an imported backup get their details back once the scan has found them
  applyPendingImports(db);
  pruneTags(db);
  // Archives that changed are opened afresh by the reader
  closeGalleries();

  progress.running = false;
  progress.phase = 'done';
  progress.current = undefined;
  progress.finishedAt = Date.now();
  report(true);
  return progress;
}

function isUnchanged(existing: Known, item: Found) {
  if (existing.kind !== item.kind || existing.mtime !== item.mtime) return false;
  return item.kind === 'folder'
    ? existing.page_count === item.imageCount
    : existing.size === item.size;
}

/** A quick 32-bit hash (FNV-1a) of a folder's page names, to notice when they change */
export function hashNames(names: string[]) {
  let hash = 0x811c9dc5;
  for (const name of names) {
    for (let i = 0; i < name.length; i++) {
      hash ^= name.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    // A zero byte between names, so ["ab", "c"] and ["a", "bc"] differ
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

async function walk(
  rootId: number,
  folder: FolderEntry,
  path: string,
  found: Found[],
  progress: ScanProgress
) {
  const files: FileEntry[] = [];
  const folders: FolderEntry[] = [];
  try {
    for await (const [, entry] of folder.entries()) {
      if (entry.kind === 'file') files.push(entry);
      else folders.push(entry);
    }
  } catch (error) {
    // No access at all stops the scan of this library folder; anything else skips one folder
    if (isAccessError(error)) throw error;
    progress.errors.push(`${path}: ${(error as Error).message}`);
    return;
  }
  const lowerFiles = new Map(files.map((file) => [file.name.toLowerCase(), file]));

  const images = files
    .map((file) => file.name)
    .filter((name) => isPage(name))
    .sort();
  if (images.length) {
    found.push({
      rootId,
      path,
      kind: 'folder',
      entry: folder,
      size: 0,
      mtime: hashNames(images),
      imageCount: images.length,
      siblings: [],
    });
  }

  // A folder's archives are checked together, rather than waiting on each in turn
  const archives = await Promise.all(
    files.map(async (file): Promise<Found | undefined> => {
      if (isUnsupportedArchive(file.name)) {
        progress.unsupported++;
        return undefined;
      }
      const kind = archiveKind(file.name);
      if (!kind) return undefined;
      const filePath = joinPath(path, file.name);
      try {
        const info = await file.getFile();
        const base = file.name.slice(0, -extname(file.name).length).toLowerCase();
        const siblings = [
          `${base}.json`,
          `${file.name.toLowerCase()}.json`,
          `${base}.info.json`,
          `${base}.xml`,
        ]
          .map((candidate) => lowerFiles.get(candidate))
          .filter((sibling): sibling is FileEntry => sibling !== undefined);
        return {
          rootId,
          path: filePath,
          kind,
          entry: file,
          size: info.size,
          mtime: Math.floor(info.lastModified),
          siblings,
        };
      } catch (error) {
        progress.errors.push(`${filePath}: ${(error as Error).message}`);
        return undefined;
      }
    })
  );
  for (const item of archives) if (item) found.push(item);

  for (const child of folders) {
    if (!SKIPPED_FOLDERS.test(child.name)) {
      await walk(rootId, child, joinPath(path, child.name), found, progress);
    }
  }
}

/** Pages identify a doujin wherever it's stored: the same names and sizes are the same book */
export async function fingerprintOf(pages: ArchiveEntry[]) {
  const text = pages.map((page) => `${page.name}\0${page.size}\n`).join('');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function processGallery(
  engine: Engine,
  item: Found,
  existing: Known | undefined,
  movedFrom: Map<string, Known[]>,
  progress: ScanProgress
) {
  const { db } = engine;
  const contents = await galleryContents(item.entry, item.kind);
  const entries = await contents.list();
  const pages = entries
    .filter((entry) => isPage(entry.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  if (!pages.length) {
    // Known doujins that no longer hold any pages can't be read: treat them as gone
    if (existing && !existing.missing) {
      db.query('UPDATE gallery SET missing = 1, mtime = ? WHERE id = ?').run(
        item.mtime,
        existing.id
      );
      progress.missing++;
    }
    return;
  }
  const fingerprint = await fingerprintOf(pages);
  const size = item.kind === 'folder' ? pages.reduce((sum, page) => sum + page.size, 0) : item.size;

  // A new path whose pages match a gallery that vanished: the same doujin, moved or renamed
  const original = existing ? undefined : movedFrom.get(fingerprint)?.shift();
  if (original) {
    db.query(
      `UPDATE gallery SET path = ?, root_id = ?, kind = ?, size = ?, mtime = ?, missing = 0 WHERE id = ?`
    ).run(item.path, item.rootId, item.kind, size, item.mtime, original.id);
    reindex(db, original.id);
    progress.moved++;
    return;
  }

  let id: number;
  const contentChanged = !existing || existing.fingerprint !== fingerprint;
  if (existing) {
    id = existing.id;
    db.query(
      `UPDATE gallery SET kind = ?, size = ?, mtime = ?, fingerprint = ?, page_count = ?, missing = 0,
         last_page = min(last_page, ? - 1)
       WHERE id = ?`
    ).run(item.kind, size, item.mtime, fingerprint, pages.length, pages.length, id);
    progress.updated++;
  } else {
    const filename = parseFilename(galleryName(item));
    id = Number(
      db
        .query(
          `INSERT INTO gallery (root_id, path, kind, size, mtime, fingerprint, page_count, title, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.rootId,
          item.path,
          item.kind,
          size,
          item.mtime,
          fingerprint,
          pages.length,
          filename.title,
          Date.now()
        ).lastInsertRowid
    );
    applyMetadata(db, id, 'filename', filename);
    progress.added++;
  }
  if (!contentChanged) return;

  db.transaction(() => {
    db.query('DELETE FROM page WHERE gallery_id = ?').run(id);
    const insert = db.query('INSERT INTO page (gallery_id, idx, name) VALUES (?, ?, ?)');
    pages.forEach((page, index) => insert.run(id, index, page.name));
  })();

  const sidecars = await readSidecars(contents, item.siblings, entries);
  if (sidecars) applyMetadata(db, id, 'sidecar', sidecars);

  await removeThumbnails(engine, id);
  await writeThumbnail(engine, await contents.read(pages[0].name), coverPath(id), COVER_WIDTH, {
    frontCover: true,
  });
}

/** The name a doujin was saved under, without the archive's extension */
function galleryName(item: Pick<Found, 'path' | 'kind'>) {
  const name = lastSegment(item.path);
  return item.kind === 'folder' ? name : name.slice(0, -extname(name).length);
}

async function readSidecars(
  contents: GalleryContents,
  siblings: FileEntry[],
  entries: ArchiveEntry[]
) {
  const found: Metadata[] = [];
  for (const entry of entries) {
    if (!isSidecar(entry.name) || entry.size > 2_000_000) continue;
    try {
      const metadata = parseSidecar(entry.name, await (await contents.read(entry.name)).text());
      if (metadata) found.push(metadata);
    } catch {
      // An unreadable sidecar adds nothing
    }
  }
  for (const sibling of siblings) {
    try {
      const kind = sibling.name.toLowerCase().endsWith('.xml') ? 'ComicInfo.xml' : 'info.json';
      const metadata = parseSidecar(kind, await (await sibling.getFile()).text());
      if (metadata) found.push(metadata);
    } catch {
      // As above
    }
  }
  return combineSidecars(found);
}

async function forEachLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  });
  await Promise.all(workers);
}
