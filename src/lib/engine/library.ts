import type {
  GalleryCard,
  GalleryDetail,
  GalleryKind,
  PageInfo,
  ReaderPrefs,
  SortKey,
  Tag,
} from '#lib/types.js';

import type { GallerySource } from './archive/index.js';
import type { Database } from './db.js';
import { NAMESPACE_ALIASES } from './metadata/tags.js';
import { parseSearch, SORTS } from './search.js';

export const PAGE_SIZE = 120;

type CardRow = {
  id: number;
  title: string;
  artists: string | null;
  language: string | null;
  page_count: number;
  last_page: number;
  read_count: number;
  favorite: number;
  rating: number | null;
  missing: number;
  fingerprint: string;
};

/** Changes whenever the pages change, so browsers can keep covers and pages forever */
const versionOf = (fingerprint: string) => fingerprint.slice(0, 10);

/**
 * A card's details. CROSS JOIN makes SQLite start from the gallery's own tags: left to choose, it
 * walks every artist in the library to skip sorting three names, which costs seconds per screen
 * in a library of thousands.
 */
const CARD_COLUMNS = `
  g.id, g.title, g.page_count, g.last_page, g.read_count, g.favorite, g.rating, g.missing,
  g.fingerprint,
  (SELECT group_concat(name, ', ') FROM (
     SELECT DISTINCT t.name FROM gallery_tag gt CROSS JOIN tag t ON t.id = gt.tag_id
     WHERE gt.gallery_id = g.id AND t.namespace = 'artist' ORDER BY t.name LIMIT 3)) AS artists,
  (SELECT t.name FROM gallery_tag gt CROSS JOIN tag t ON t.id = gt.tag_id
   WHERE gt.gallery_id = g.id AND t.namespace = 'language'
     AND t.name NOT IN ('translated', 'rewrite', 'speechless', 'text cleaned')
   LIMIT 1) AS language`;

function toCard(row: CardRow): GalleryCard {
  return {
    id: row.id,
    title: row.title,
    artists: row.artists,
    language: row.language,
    pageCount: row.page_count,
    lastPage: row.last_page,
    readCount: row.read_count,
    favorite: row.favorite === 1,
    rating: row.rating,
    missing: row.missing === 1,
    version: versionOf(row.fingerprint),
  };
}

export function queryGalleries(
  db: Database,
  {
    query = '',
    sort = 'added',
    seed = 0,
    offset = 0,
    limit = PAGE_SIZE,
  }: {
    query?: string;
    sort?: SortKey;
    seed?: number;
    offset?: number;
    limit?: number;
  }
) {
  const { where, params } = parseSearch(query);
  const conditions = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db
    .query<{ total: number }, (string | number)[]>(
      `SELECT count(*) AS total FROM gallery g ${conditions}`
    )
    .get(...params)!.total;
  const orderParams = sort === 'random' ? [seed] : [];
  // The page is chosen first and its cards built after: sorting with the card details in the
  // query builds them for every match, not just the ones shown
  const ids = db
    .query<{ id: number }, (string | number)[]>(
      `SELECT g.id FROM gallery g ${conditions} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`
    )
    .all(...params, ...orderParams, limit, offset)
    .map((row) => row.id);
  return { total, items: cardsFor(db, ids) };
}

/** Cards for these galleries, in the order given */
function cardsFor(db: Database, ids: number[]) {
  if (!ids.length) return [];
  return db
    .query<CardRow, [string]>(
      `SELECT ${CARD_COLUMNS} FROM json_each(?) AS chosen CROSS JOIN gallery g ON g.id = chosen.value
       ORDER BY chosen.key`
    )
    .all(JSON.stringify(ids))
    .map(toCard);
}

/** Galleries started but not finished, most recent first */
export function continueReading(db: Database, limit = 12) {
  const ids = db
    .query<{ id: number }, [number]>(
      `SELECT g.id FROM gallery g
       WHERE g.missing = 0 AND g.last_read_at IS NOT NULL AND g.last_page > 0
         AND g.last_page < g.page_count - 1
       ORDER BY g.last_read_at DESC LIMIT ?`
    )
    .all(limit)
    .map((row) => row.id);
  return cardsFor(db, ids);
}

type DetailRow = {
  id: number;
  path: string;
  kind: GalleryKind;
  title: string;
  title_jpn: string | null;
  category: string | null;
  title_source: string;
  page_count: number;
  last_page: number;
  last_read_at: number | null;
  read_count: number;
  favorite: number;
  rating: number | null;
  missing: number;
  added_at: number;
  fingerprint: string;
  eh_gid: number | null;
  eh_token: string | null;
  reader_prefs: string | null;
};

export function getGallery(db: Database, id: number): GalleryDetail | undefined {
  const row = db.query<DetailRow, [number]>('SELECT * FROM gallery WHERE id = ?').get(id);
  if (!row) return undefined;
  return {
    id: row.id,
    path: row.path,
    kind: row.kind,
    title: row.title,
    titleJpn: row.title_jpn,
    category: row.category,
    titleSource: row.title_source,
    pageCount: row.page_count,
    lastPage: row.last_page,
    lastReadAt: row.last_read_at,
    readCount: row.read_count,
    favorite: row.favorite === 1,
    rating: row.rating,
    missing: row.missing === 1,
    addedAt: row.added_at,
    version: versionOf(row.fingerprint),
    ehGid: row.eh_gid,
    ehToken: row.eh_token,
    tags: galleryTags(db, id),
    collections: db
      .query<{ id: number; name: string }, [number]>(
        `SELECT c.id, c.name FROM collection c JOIN collection_gallery cg ON cg.collection_id = c.id
         WHERE cg.gallery_id = ? ORDER BY c.name COLLATE NOCASE`
      )
      .all(id),
    readerPrefs: row.reader_prefs ? (JSON.parse(row.reader_prefs) as Partial<ReaderPrefs>) : null,
  };
}

export function galleryTags(db: Database, id: number): Tag[] {
  return db
    .query<Tag, [number]>(
      // Starting from the gallery's own tags, as for the cards above
      `SELECT DISTINCT t.namespace, t.name FROM gallery_tag gt CROSS JOIN tag t ON t.id = gt.tag_id
       WHERE gt.gallery_id = ? ORDER BY t.namespace, t.name`
    )
    .all(id);
}

/** What the reader and thumbnails need to find a gallery's files */
export function gallerySource(db: Database, id: number): GallerySource | undefined {
  return (
    db
      .query<GallerySource, [number]>(
        `SELECT g.id, g.root_id AS rootId, r.path AS rootPath, g.path, g.kind, g.fingerprint
         FROM gallery g JOIN library_root r ON r.id = g.root_id
         WHERE g.id = ? AND g.missing = 0`
      )
      .get(id) ?? undefined
  );
}

export function pageName(db: Database, id: number, index: number) {
  return db
    .query<{ name: string }, [number, number]>(
      'SELECT name FROM page WHERE gallery_id = ? AND idx = ?'
    )
    .get(id, index)?.name;
}

export function pageInfos(db: Database, id: number): PageInfo[] {
  return db
    .query<PageInfo, [number]>('SELECT width, height FROM page WHERE gallery_id = ? ORDER BY idx')
    .all(id);
}

export function setPageSize(
  db: Database,
  id: number,
  index: number,
  width: number,
  height: number
) {
  db.query('UPDATE page SET width = ?, height = ? WHERE gallery_id = ? AND idx = ?').run(
    width,
    height,
    id,
    index
  );
}

export type GalleryUpdate = {
  favorite?: boolean;
  rating?: number | null;
  readerPrefs?: Partial<ReaderPrefs> | null;
};

export function updateGallery(db: Database, id: number, update: GalleryUpdate) {
  if (update.favorite !== undefined) {
    db.query('UPDATE gallery SET favorite = ? WHERE id = ?').run(update.favorite ? 1 : 0, id);
  }
  if (update.rating !== undefined) {
    const rating =
      update.rating === null ? null : Math.min(5, Math.max(1, Math.round(update.rating)));
    db.query('UPDATE gallery SET rating = ? WHERE id = ?').run(rating, id);
  }
  if (update.readerPrefs !== undefined) {
    db.query('UPDATE gallery SET reader_prefs = ? WHERE id = ?').run(
      update.readerPrefs ? JSON.stringify(update.readerPrefs) : null,
      id
    );
  }
}

/**
 * Remembers where someone stopped. Reaching the last page counts as one more read, once:
 * turning back and forth on it doesn't count again.
 */
export function saveProgress(db: Database, id: number, page: number) {
  const gallery = db
    .query<{ page_count: number; last_page: number }, [number]>(
      'SELECT page_count, last_page FROM gallery WHERE id = ?'
    )
    .get(id);
  if (!gallery) return;
  const clamped = Math.min(Math.max(0, Math.floor(page)), gallery.page_count - 1);
  const finished = clamped === gallery.page_count - 1 && gallery.last_page !== clamped;
  db.query(
    `UPDATE gallery SET last_page = ?, last_read_at = ?, read_count = read_count + ? WHERE id = ?`
  ).run(clamped, Date.now(), finished ? 1 : 0, id);
}

/** Starts a gallery over from its first page */
export function resetProgress(db: Database, id: number) {
  db.query(
    'UPDATE gallery SET last_page = 0, read_count = 0, last_read_at = NULL WHERE id = ?'
  ).run(id);
}

export function listTags(db: Database, { prefix = '', namespace = '', limit = 20 } = {}) {
  const conditions = ['1 = 1'];
  const params: (string | number)[] = [];
  if (namespace) {
    // Searches accept short names such as a: and p:, so suggestions do too
    conditions.push('t.namespace = ?');
    params.push(NAMESPACE_ALIASES[namespace.toLowerCase()] ?? namespace.toLowerCase());
  }
  if (prefix) {
    conditions.push(`t.name LIKE ? ESCAPE '\\'`);
    params.push(`${prefix.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
  }
  params.push(limit);
  // Each matching tag is counted from its own entries in the tag index. Joining every tag link to
  // its gallery and grouping them all took seconds in a large library, even to suggest eight tags.
  return db
    .query<Tag & { count: number }, (string | number)[]>(
      `WITH counted AS MATERIALIZED (
         SELECT t.namespace, t.name,
           (SELECT count(DISTINCT gt.gallery_id) FROM gallery_tag gt
            WHERE gt.tag_id = t.id
              AND gt.gallery_id NOT IN (SELECT id FROM gallery WHERE missing = 1)) AS count
         FROM tag t WHERE ${conditions.join(' AND ')})
       SELECT namespace, name, count FROM counted WHERE count > 0
       ORDER BY count DESC, name LIMIT ?`
    )
    .all(...params);
}

export function listCollections(db: Database) {
  return db
    .query<
      {
        id: number;
        name: string;
        count: number;
        coverId: number | null;
        coverVersion: string | null;
      },
      []
    >(
      `SELECT c.id, c.name, count(g.id) AS count,
         (SELECT g2.id FROM collection_gallery cg2 JOIN gallery g2 ON g2.id = cg2.gallery_id
          WHERE cg2.collection_id = c.id ORDER BY cg2.position LIMIT 1) AS coverId,
         (SELECT substr(g2.fingerprint, 1, 10) FROM collection_gallery cg2 JOIN gallery g2 ON g2.id = cg2.gallery_id
          WHERE cg2.collection_id = c.id ORDER BY cg2.position LIMIT 1) AS coverVersion
       FROM collection c
       LEFT JOIN collection_gallery cg ON cg.collection_id = c.id
       LEFT JOIN gallery g ON g.id = cg.gallery_id
       GROUP BY c.id ORDER BY c.name COLLATE NOCASE`
    )
    .all();
}

export function createCollection(db: Database, name: string) {
  return Number(
    db.query('INSERT INTO collection (name, created_at) VALUES (?, ?)').run(name.trim(), Date.now())
      .lastInsertRowid
  );
}

export function renameCollection(db: Database, id: number, name: string) {
  db.query('UPDATE collection SET name = ? WHERE id = ?').run(name.trim(), id);
}

export function deleteCollection(db: Database, id: number) {
  db.query('DELETE FROM collection WHERE id = ?').run(id);
}

export function setInCollection(
  db: Database,
  collectionId: number,
  galleryId: number,
  inside: boolean
) {
  if (inside) {
    db.query(
      `INSERT OR IGNORE INTO collection_gallery (collection_id, gallery_id, position)
       VALUES (?, ?, (SELECT coalesce(max(position), 0) + 1 FROM collection_gallery WHERE collection_id = ?))`
    ).run(collectionId, galleryId, collectionId);
  } else {
    db.query('DELETE FROM collection_gallery WHERE collection_id = ? AND gallery_id = ?').run(
      collectionId,
      galleryId
    );
  }
}

export function listRoots(db: Database) {
  return db
    .query<{ id: number; path: string; count: number }, []>(
      `SELECT r.id, r.path, count(g.id) AS count FROM library_root r
       LEFT JOIN gallery g ON g.root_id = r.id AND g.missing = 0
       GROUP BY r.id ORDER BY r.path COLLATE NOCASE`
    )
    .all();
}

/**
 * Adds a library folder under its own name, which starts the path of every doujin in it. Two
 * folders with the same name get "(2)", "(3)" and so on, so paths stay unique.
 */
export function addRoot(db: Database, name: string) {
  const taken = new Set(listRoots(db).map((root) => root.path.toLowerCase()));
  const base = name.replaceAll('/', '_') || 'Library';
  let path = base;
  for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${base} (${n})`;
  return Number(
    db.query('INSERT INTO library_root (path, added_at) VALUES (?, ?)').run(path, Date.now())
      .lastInsertRowid
  );
}

export const hasRoots = (db: Database) =>
  db.query<{ any: number }, []>('SELECT EXISTS (SELECT 1 FROM library_root) AS any').get()!.any ===
  1;

export function libraryStats(db: Database) {
  return db
    .query<{ total: number; missing: number }, []>(
      `SELECT count(*) FILTER (WHERE missing = 0) AS total,
         count(*) FILTER (WHERE missing = 1) AS missing
       FROM gallery`
    )
    .get()!;
}
