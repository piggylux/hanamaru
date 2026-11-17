import type { Database } from '../db.js';
import { SOURCES, type Metadata, type Source, type Tag } from './tags.js';

/** How trusted a source is: lower is more trusted */
export const sourceRank = (source: string) => {
  const index = SOURCES.indexOf(source as Source);
  return index < 0 ? SOURCES.length : index;
};

function tagIds(db: Database, tags: Tag[]) {
  const insert = db.query('INSERT INTO tag (namespace, name) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const find = db.query<{ id: number }, [string, string]>(
    'SELECT id FROM tag WHERE namespace = ? AND name = ?'
  );
  return tags.map((tag) => {
    insert.run(tag.namespace, tag.name);
    return find.get(tag.namespace, tag.name)!.id;
  });
}

/** Replaces every tag of a gallery, each with the source it came from, as a backup recorded them */
export function replaceAllTags(
  db: Database,
  galleryId: number,
  tags: (Tag & { source: Source })[]
) {
  db.query('DELETE FROM gallery_tag WHERE gallery_id = ?').run(galleryId);
  const insert = db.query(
    'INSERT OR IGNORE INTO gallery_tag (gallery_id, tag_id, source) VALUES (?, ?, ?)'
  );
  tagIds(db, tags).forEach((id, index) => insert.run(galleryId, id, tags[index].source));
}

function setSourceTags(db: Database, galleryId: number, source: Source, tags: Tag[]) {
  db.query('DELETE FROM gallery_tag WHERE gallery_id = ? AND source = ?').run(galleryId, source);
  const insert = db.query(
    'INSERT OR IGNORE INTO gallery_tag (gallery_id, tag_id, source) VALUES (?, ?, ?)'
  );
  for (const id of tagIds(db, tags)) insert.run(galleryId, id, source);
}

/**
 * Records what one source says about a gallery. Its tags replace that source's earlier tags only,
 * so refreshing E-Hentai never loses tags typed by hand. The title comes from the most trusted
 * source that has one: typed by hand, then E-Hentai, then sidecar files, then the file name.
 */
export function applyMetadata(db: Database, galleryId: number, source: Source, metadata: Metadata) {
  db.transaction(() => {
    setSourceTags(db, galleryId, source, metadata.tags);
    const current = db
      .query<{ title_source: string }, [number]>('SELECT title_source FROM gallery WHERE id = ?')
      .get(galleryId);
    if (metadata.title && current && sourceRank(source) <= sourceRank(current.title_source)) {
      db.query(
        `UPDATE gallery SET title = ?, title_jpn = ?, category = coalesce(?, category), title_source = ?
         WHERE id = ?`
      ).run(
        metadata.title,
        metadata.titleJpn ?? null,
        metadata.category ?? null,
        source,
        galleryId
      );
    }
    if (metadata.ehGid !== undefined && metadata.ehToken) {
      db.query(
        `UPDATE gallery SET eh_gid = ?, eh_token = ? WHERE id = ? AND (eh_gid IS NULL OR ? = 'ehentai')`
      ).run(metadata.ehGid, metadata.ehToken, galleryId, source);
    }
    reindex(db, galleryId);
  })();
}

/**
 * What someone typed in the edit dialog becomes the gallery's whole tag list: tags from every
 * other source are dropped, so removing a tag that came from the file name sticks
 */
export function setManualMetadata(
  db: Database,
  galleryId: number,
  { title, titleJpn, tags }: { title: string; titleJpn?: string; tags: Tag[] }
) {
  db.transaction(() => {
    db.query('DELETE FROM gallery_tag WHERE gallery_id = ?').run(galleryId);
    setSourceTags(db, galleryId, 'manual', tags);
    db.query(
      `UPDATE gallery SET title = ?, title_jpn = ?, title_source = 'manual' WHERE id = ?`
    ).run(title, titleJpn || null, galleryId);
    reindex(db, galleryId);
  })();
}

/**
 * Keeps a gallery's search entry in step with its title, tags and path. The path is taken from
 * inside its library folder: the folder's own name is shared by every gallery in it, so searching
 * for a word of it would match them all.
 */
export function reindex(db: Database, galleryId: number) {
  db.query('DELETE FROM gallery_fts WHERE rowid = ?').run(galleryId);
  db.query(
    `INSERT INTO gallery_fts (rowid, title, title_jpn, tags, path)
     SELECT g.id, g.title, coalesce(g.title_jpn, ''),
       coalesce((SELECT group_concat(t.namespace || ':' || t.name, ' ')
                 FROM (SELECT DISTINCT tag_id FROM gallery_tag WHERE gallery_id = g.id) gt
                 JOIN tag t ON t.id = gt.tag_id), ''),
       CASE WHEN substr(g.path, 1, length(r.path)) = r.path
         THEN ltrim(substr(g.path, length(r.path) + 1), '\\/')
         ELSE g.path END
     FROM gallery g JOIN library_root r ON r.id = g.root_id WHERE g.id = ?`
  ).run(galleryId);
}

/** Tags nobody uses any more, after galleries were removed or retagged */
export function pruneTags(db: Database) {
  db.run('DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM gallery_tag)');
}
