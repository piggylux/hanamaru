/** A value SQLite stores or returns */
export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

export type RunResult = { changes: number; lastInsertRowid: number | bigint };

export interface Statement<Row, Params extends SqlValue[]> {
  all(...params: Params): Row[];
  get(...params: Params): Row | null;
  run(...params: Params): RunResult;
}

/**
 * The part of a SQLite connection the engine uses. The browser's is SQLite compiled to
 * WebAssembly (`sqlite.ts`); tests use Bun's own (`test-helpers.ts`). Both cache prepared
 * statements by their SQL, so `query()` is cheap to call again.
 */
export interface Database {
  query<Row = Record<string, SqlValue>, Params extends SqlValue[] = SqlValue[]>(
    sql: string
  ): Statement<Row, Params>;
  /** Runs one or more statements that take no parameters */
  run(sql: string): void;
  /** Wraps a function in a transaction, nested ones in a savepoint. The function must be synchronous */
  transaction<Args extends unknown[], Result>(
    work: (...args: Args) => Result
  ): (...args: Args) => Result;
  close(): void;
}

/** Settings every connection starts with, before any migration */
export const PRAGMAS = [
  'PRAGMA temp_store = MEMORY',
  'PRAGMA foreign_keys = ON',
  // Skips a disk flush on most commits, which a scan makes thousands of. A power cut at the worst
  // moment could lose the last commits; everything here can be found again by scanning.
  'PRAGMA synchronous = NORMAL',
];

/**
 * Each entry upgrades the database by one version. `PRAGMA user_version` records how many have
 * run, so add new steps at the end and never edit one that has shipped.
 */
const MIGRATIONS = [
  `
  CREATE TABLE library_root (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE gallery (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL REFERENCES library_root(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    title TEXT NOT NULL,
    title_jpn TEXT,
    category TEXT,
    title_source TEXT NOT NULL DEFAULT 'filename',
    rating INTEGER,
    favorite INTEGER NOT NULL DEFAULT 0,
    last_page INTEGER NOT NULL DEFAULT 0,
    last_read_at INTEGER,
    read_count INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    missing INTEGER NOT NULL DEFAULT 0,
    reader_prefs TEXT,
    eh_gid INTEGER,
    eh_token TEXT,
    eh_status TEXT,
    eh_candidates TEXT
  );
  CREATE INDEX gallery_fingerprint ON gallery(fingerprint);
  CREATE INDEX gallery_added ON gallery(added_at);
  CREATE INDEX gallery_last_read ON gallery(last_read_at);

  CREATE TABLE page (
    gallery_id INTEGER NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    name TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    PRIMARY KEY (gallery_id, idx)
  ) WITHOUT ROWID;

  CREATE TABLE tag (
    id INTEGER PRIMARY KEY,
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (namespace, name)
  );

  CREATE TABLE gallery_tag (
    gallery_id INTEGER NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    PRIMARY KEY (gallery_id, tag_id, source)
  ) WITHOUT ROWID;
  CREATE INDEX gallery_tag_tag ON gallery_tag(tag_id);

  CREATE TABLE collection (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE collection_gallery (
    collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
    gallery_id INTEGER NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (collection_id, gallery_id)
  ) WITHOUT ROWID;

  CREATE TABLE setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Trigram tokens find any part of a title, including Japanese titles, which have no spaces
  CREATE VIRTUAL TABLE gallery_fts USING fts5(title, title_jpn, tags, path, tokenize = 'trigram');
  `,
  // Search paths from inside their library folder, as reindex() in metadata/apply.ts now writes
  // them: the folder's own name matched every gallery in it
  `
  DELETE FROM gallery_fts;
  INSERT INTO gallery_fts (rowid, title, title_jpn, tags, path)
  SELECT g.id, g.title, coalesce(g.title_jpn, ''),
    coalesce((SELECT group_concat(t.namespace || ':' || t.name, ' ')
              FROM (SELECT DISTINCT tag_id FROM gallery_tag WHERE gallery_id = g.id) gt
              JOIN tag t ON t.id = gt.tag_id), ''),
    CASE WHEN substr(g.path, 1, length(r.path)) = r.path
      THEN ltrim(substr(g.path, length(r.path) + 1), '\\/')
      ELSE g.path END
  FROM gallery g JOIN library_root r ON r.id = g.root_id;
  `,
  // Doujins from an imported backup that aren't in the library yet: each is restored once a scan
  // finds it, by its pages or its path
  `
  CREATE TABLE pending_import (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    path TEXT NOT NULL,
    data TEXT NOT NULL,
    imported_at INTEGER NOT NULL
  );
  CREATE INDEX pending_import_fingerprint ON pending_import(fingerprint);
  `,
];

/** Brings a freshly opened connection up to date: its settings, then any migrations it hasn't had */
export function prepareDatabase(db: Database) {
  for (const pragma of PRAGMAS) db.run(pragma);
  const { user_version: version } = db
    .query<{ user_version: number }, []>('PRAGMA user_version')
    .get()!;
  for (let step = version; step < MIGRATIONS.length; step++) {
    db.transaction(() => {
      db.run(MIGRATIONS[step]);
      db.run(`PRAGMA user_version = ${step + 1}`);
    })();
  }
  return db;
}
