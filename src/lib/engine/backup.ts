import type { GalleryKind, ImportResult, ReaderPrefs } from '#lib/types.js';

import type { Database } from './db.js';
import { setInCollection } from './library.js';
import { reindex, replaceAllTags, sourceRank } from './metadata/apply.js';
import { normalizeTag, SOURCES, type Source } from './metadata/tags.js';
import { cleanReaderPrefs, getSetting, setSetting } from './settings.js';

/**
 * E-Hentai matches made by the earlier server version of hanamaru. They're kept in the database
 * and in backups as they were, so a backup made before still restores them in full.
 */
type EhStatus = 'matched' | 'review' | 'none' | 'error';

type EhCandidate = {
  gid: number;
  token: string;
  title: string;
  titleJpn: string | null;
  category: string;
  thumb: string;
  fileCount: number;
  posted: number;
  language: string | null;
  tags: string[];
  byImage: boolean;
};

/**
 * A backup of everything hanamaru knows about a library, as one JSON file: titles, tags, favorites,
 * ratings, reading progress, E-Hentai matches, collections, library folder names and reader
 * settings. The doujins themselves aren't in it.
 *
 * Importing merges a backup into the library. Each doujin is found by its pages (the fingerprint
 * scans compute), so it's restored even if it was moved or renamed, then by its path. Doujins that
 * aren't in the library yet wait in `pending_import` until a scan finds them.
 */
export const BACKUP_FORMAT = 'hanamaru-library';
export const BACKUP_VERSION = 1;

export class BackupError extends Error {}

type BackupKind = GalleryKind | 'rar' | '7z';

export type GalleryBackup = {
  fingerprint: string;
  path: string;
  kind: BackupKind;
  pageCount: number;
  missing: boolean;
  title: string;
  titleJpn: string | null;
  category: string | null;
  titleSource: Source;
  favorite: boolean;
  rating: number | null;
  lastPage: number;
  lastReadAt: number | null;
  readCount: number;
  addedAt: number;
  readerPrefs: ReaderPrefs | null;
  eh: { gid: number; token: string } | null;
  ehStatus: EhStatus | null;
  ehCandidates: EhCandidate[] | null;
  tags: { namespace: string; name: string; source: Source }[];
  collections: string[];
};

export type LibraryBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  roots: string[];
  settings: { readerDefaults: ReaderPrefs };
  collections: { name: string; createdAt: number }[];
  galleries: GalleryBackup[];
};

type GalleryRow = {
  id: number;
  path: string;
  kind: GalleryKind;
  fingerprint: string;
  page_count: number;
  missing: number;
  title: string;
  title_jpn: string | null;
  category: string | null;
  title_source: string;
  favorite: number;
  rating: number | null;
  last_page: number;
  last_read_at: number | null;
  read_count: number;
  added_at: number;
  reader_prefs: string | null;
  eh_gid: number | null;
  eh_token: string | null;
  eh_status: EhStatus | null;
  eh_candidates: string | null;
};

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function groupBy<T extends { gallery_id: number }>(rows: T[]) {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const group = groups.get(row.gallery_id) ?? [];
    group.push(row);
    groups.set(row.gallery_id, group);
  }
  return groups;
}

export function exportLibrary(db: Database): LibraryBackup {
  const tags = groupBy(
    db
      .query<{ gallery_id: number; namespace: string; name: string; source: Source }, []>(
        `SELECT gt.gallery_id, t.namespace, t.name, gt.source
         FROM gallery_tag gt JOIN tag t ON t.id = gt.tag_id
         ORDER BY gt.gallery_id, t.namespace, t.name`
      )
      .all()
  );
  const memberships = groupBy(
    db
      .query<{ gallery_id: number; name: string }, []>(
        `SELECT cg.gallery_id, c.name FROM collection_gallery cg
         JOIN collection c ON c.id = cg.collection_id ORDER BY cg.position`
      )
      .all()
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    roots: db
      .query<{ path: string }, []>('SELECT path FROM library_root ORDER BY id')
      .all()
      .map((root) => root.path),
    settings: {
      readerDefaults: getSetting(db, 'readerDefaults'),
    },
    collections: db
      .query<{ name: string; createdAt: number }, []>(
        'SELECT name, created_at AS createdAt FROM collection ORDER BY id'
      )
      .all(),
    galleries: db
      .query<GalleryRow, []>('SELECT * FROM gallery ORDER BY id')
      .all()
      .map((row) => ({
        fingerprint: row.fingerprint,
        path: row.path,
        kind: row.kind,
        pageCount: row.page_count,
        missing: row.missing === 1,
        title: row.title,
        titleJpn: row.title_jpn,
        category: row.category,
        titleSource: row.title_source as Source,
        favorite: row.favorite === 1,
        rating: row.rating,
        lastPage: row.last_page,
        lastReadAt: row.last_read_at,
        readCount: row.read_count,
        addedAt: row.added_at,
        readerPrefs: row.reader_prefs ? cleanReaderPrefs(parseJson(row.reader_prefs)) : null,
        eh: row.eh_gid && row.eh_token ? { gid: row.eh_gid, token: row.eh_token } : null,
        ehStatus: row.eh_status,
        ehCandidates: cleanCandidates(parseJson(row.eh_candidates)),
        tags: (tags.get(row.id) ?? []).map(({ namespace, name, source }) => ({
          namespace,
          name,
          source,
        })),
        collections: (memberships.get(row.id) ?? []).map((membership) => membership.name),
      })),
  };
}

/** RAR and 7z doujins from the server version are accepted, and wait like any doujin not found */
const KINDS: BackupKind[] = ['folder', 'zip', 'rar', '7z'];
const STATUSES: EhStatus[] = ['matched', 'review', 'none', 'error'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const whole = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;

const sourceOf = (value: unknown): Source =>
  SOURCES.includes(value as Source) ? (value as Source) : 'filename';

function cleanCandidates(value: unknown): EhCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const candidates = value.filter(
    (candidate): candidate is EhCandidate =>
      isObject(candidate) &&
      typeof candidate.gid === 'number' &&
      typeof candidate.token === 'string' &&
      typeof candidate.title === 'string'
  );
  return candidates.length ? candidates : null;
}

/** One doujin from a file, with every field checked; undefined when it can't be used */
export function cleanGallery(value: unknown): GalleryBackup | undefined {
  if (!isObject(value)) return undefined;
  const { fingerprint, path, kind } = value;
  if (typeof fingerprint !== 'string' || typeof path !== 'string' || !path.trim()) return undefined;
  if (!KINDS.includes(kind as BackupKind)) return undefined;
  const text = (field: unknown) =>
    typeof field === 'string' && field.trim() ? field.trim() : null;
  const eh = isObject(value.eh) ? value.eh : undefined;

  return {
    fingerprint,
    path,
    kind: kind as BackupKind,
    pageCount: Math.max(0, whole(value.pageCount, 0)),
    missing: value.missing === true,
    title: text(value.title) ?? path.split(/[\\/]/).at(-1)!,
    titleJpn: text(value.titleJpn),
    category: text(value.category),
    titleSource: sourceOf(value.titleSource),
    favorite: value.favorite === true,
    rating:
      typeof value.rating === 'number' ? Math.min(5, Math.max(1, Math.round(value.rating))) : null,
    lastPage: Math.max(0, whole(value.lastPage, 0)),
    lastReadAt: typeof value.lastReadAt === 'number' ? value.lastReadAt : null,
    readCount: Math.max(0, whole(value.readCount, 0)),
    addedAt: whole(value.addedAt, Date.now()),
    readerPrefs: isObject(value.readerPrefs) ? cleanReaderPrefs(value.readerPrefs) : null,
    eh:
      eh &&
      Number.isInteger(eh.gid) &&
      typeof eh.token === 'string' &&
      /^[0-9a-f]{10}$/i.test(eh.token)
        ? { gid: eh.gid as number, token: eh.token.toLowerCase() }
        : null,
    ehStatus: STATUSES.includes(value.ehStatus as EhStatus) ? (value.ehStatus as EhStatus) : null,
    ehCandidates: cleanCandidates(value.ehCandidates),
    tags: (Array.isArray(value.tags) ? value.tags : []).flatMap((tag) => {
      if (!isObject(tag)) return [];
      const clean = normalizeTag(String(tag.namespace ?? ''), String(tag.name ?? ''));
      return clean ? [{ ...clean, source: sourceOf(tag.source) }] : [];
    }),
    collections: (Array.isArray(value.collections) ? value.collections : [])
      .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
      .map((name) => name.trim()),
  };
}

/** The library's doujin a backup entry describes: the same pages first, then the same path */
function findGallery(db: Database, gallery: GalleryBackup, claimed: Set<number>) {
  if (gallery.fingerprint) {
    const samePages = db
      .query<{ id: number }, [string, string]>(
        'SELECT id FROM gallery WHERE fingerprint = ? ORDER BY missing, path = ? DESC, id'
      )
      .all(gallery.fingerprint, gallery.path)
      .find((row) => !claimed.has(row.id));
    if (samePages) return samePages.id;
  }
  const samePath = db
    .query<{ id: number }, [string]>('SELECT id FROM gallery WHERE path = ?')
    .get(gallery.path);
  return samePath && !claimed.has(samePath.id) ? samePath.id : undefined;
}

function collectionId(db: Database, name: string) {
  db.query('INSERT OR IGNORE INTO collection (name, created_at) VALUES (?, ?)').run(
    name,
    Date.now()
  );
  return db.query<{ id: number }, [string]>('SELECT id FROM collection WHERE name = ?').get(name)!
    .id;
}

/**
 * Gives a doujin its details back from a backup, merging with what the library already knows:
 * - the title from the more trusted source (typed by hand, E-Hentai, sidecar, file name)
 * - a favorite in either stays a favorite, and the backup's rating and reader settings win
 * - progress from whichever was read more recently
 * - the backup's tags, each with the source it came from
 */
function restoreGallery(db: Database, id: number, gallery: GalleryBackup) {
  const current = db
    .query<
      { title_source: string; last_read_at: number | null; eh_status: EhStatus | null },
      [number]
    >('SELECT title_source, last_read_at, eh_status FROM gallery WHERE id = ?')
    .get(id)!;

  if (sourceRank(gallery.titleSource) <= sourceRank(current.title_source)) {
    db.query(
      'UPDATE gallery SET title = ?, title_jpn = ?, category = ?, title_source = ? WHERE id = ?'
    ).run(gallery.title, gallery.titleJpn, gallery.category, gallery.titleSource, id);
  }

  db.query(
    `UPDATE gallery SET favorite = max(favorite, ?), rating = coalesce(?, rating),
       reader_prefs = coalesce(?, reader_prefs), added_at = min(added_at, ?),
       read_count = max(read_count, ?)
     WHERE id = ?`
  ).run(
    gallery.favorite ? 1 : 0,
    gallery.rating,
    gallery.readerPrefs ? JSON.stringify(gallery.readerPrefs) : null,
    gallery.addedAt,
    gallery.readCount,
    id
  );

  if ((gallery.lastReadAt ?? 0) > (current.last_read_at ?? 0)) {
    db.query(
      'UPDATE gallery SET last_page = max(0, min(?, page_count - 1)), last_read_at = ? WHERE id = ?'
    ).run(gallery.lastPage, gallery.lastReadAt, id);
  }

  // A match in the library is only replaced by another match
  if (current.eh_status !== 'matched' || gallery.ehStatus === 'matched') {
    if (gallery.eh || gallery.ehStatus) {
      db.query(
        'UPDATE gallery SET eh_gid = ?, eh_token = ?, eh_status = ?, eh_candidates = ? WHERE id = ?'
      ).run(
        gallery.eh?.gid ?? null,
        gallery.eh?.token ?? null,
        gallery.ehStatus,
        gallery.ehCandidates ? JSON.stringify(gallery.ehCandidates) : null,
        id
      );
    }
  }

  if (gallery.tags.length) replaceAllTags(db, id, gallery.tags);
  for (const name of gallery.collections) setInCollection(db, collectionId(db, name), id, true);
  reindex(db, id);
}

function keepForLater(db: Database, gallery: GalleryBackup) {
  db.query('DELETE FROM pending_import WHERE fingerprint = ? AND path = ?').run(
    gallery.fingerprint,
    gallery.path
  );
  db.query(
    'INSERT INTO pending_import (fingerprint, path, data, imported_at) VALUES (?, ?, ?, ?)'
  ).run(gallery.fingerprint, gallery.path, JSON.stringify(gallery), Date.now());
}

/**
 * Merges a backup into the library. Reader settings and collections come back at once, and each
 * doujin is restored now or once a scan finds it.
 */
export function importLibrary(db: Database, data: unknown): ImportResult {
  if (!isObject(data) || data.format !== BACKUP_FORMAT) {
    throw new BackupError("That file isn't a hanamaru library export");
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupError(
      'That file comes from a newer version of hanamaru; update hanamaru first'
    );
  }

  const result: ImportResult = { restored: 0, waiting: 0, skipped: 0, collections: 0 };
  db.transaction(() => {
    // Library folders can't come from a file: the browser only opens folders picked by hand
    if (isObject(data.settings) && isObject(data.settings.readerDefaults)) {
      setSetting(db, 'readerDefaults', cleanReaderPrefs(data.settings.readerDefaults));
    }

    for (const collection of Array.isArray(data.collections) ? data.collections : []) {
      if (!isObject(collection) || typeof collection.name !== 'string' || !collection.name.trim()) {
        continue;
      }
      result.collections += db
        .query('INSERT OR IGNORE INTO collection (name, created_at) VALUES (?, ?)')
        .run(collection.name.trim(), whole(collection.createdAt, Date.now())).changes;
    }

    const claimed = new Set<number>();
    for (const entry of Array.isArray(data.galleries) ? data.galleries : []) {
      const gallery = cleanGallery(entry);
      if (!gallery) {
        result.skipped++;
        continue;
      }
      const id = findGallery(db, gallery, claimed);
      if (id === undefined) {
        keepForLater(db, gallery);
        result.waiting++;
      } else {
        claimed.add(id);
        restoreGallery(db, id, gallery);
        result.restored++;
      }
    }
  })();
  return result;
}

/** Restores the imported doujins a scan has now found; returns how many */
export function applyPendingImports(db: Database) {
  const pending = db
    .query<{ id: number; data: string }, []>('SELECT id, data FROM pending_import ORDER BY id')
    .all();
  if (!pending.length) return 0;
  let applied = 0;
  const claimed = new Set<number>();
  db.transaction(() => {
    const done = db.query('DELETE FROM pending_import WHERE id = ?');
    for (const row of pending) {
      const gallery = cleanGallery(parseJson(row.data));
      if (!gallery) {
        done.run(row.id);
        continue;
      }
      const id = findGallery(db, gallery, claimed);
      if (id === undefined) continue;
      claimed.add(id);
      restoreGallery(db, id, gallery);
      done.run(row.id);
      applied++;
    }
  })();
  return applied;
}

export function pendingImportCount(db: Database) {
  return db.query<{ count: number }, []>('SELECT count(*) AS count FROM pending_import').get()!
    .count;
}

export function forgetPendingImports(db: Database) {
  return db.query('DELETE FROM pending_import').run().changes;
}
