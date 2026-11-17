import { beforeAll, describe, expect, it } from 'bun:test';

import type { Database } from './db.js';
import {
  createCollection,
  listTags,
  queryGalleries,
  saveProgress,
  setInCollection,
} from './library.js';
import { applyMetadata } from './metadata/apply.js';
import { parseTag } from './metadata/tags.js';
import { tokenize } from './search.js';
import { openTestDatabase } from './test-helpers.js';

let db: Database;
const ids: Record<string, number> = {};

function add(key: string, title: string, tags: string[], extra: Record<string, number> = {}) {
  const id = Number(
    db
      .query(
        `INSERT INTO gallery (root_id, path, kind, size, mtime, fingerprint, page_count, title, added_at)
         VALUES (1, ?, 'zip', 1, 1, ?, ?, ?, ?)`
      )
      .run(`C:\\lib\\${key}.cbz`, key.padEnd(10, '0'), extra.pages ?? 20, title, extra.added ?? 0)
      .lastInsertRowid
  );
  applyMetadata(db, id, 'filename', { tags: tags.map((tag) => parseTag(tag)!) });
  ids[key] = id;
}

const find = (query: string) =>
  queryGalleries(db, { query, sort: 'title' })
    .items.map((item) => Object.entries(ids).find(([, id]) => id === item.id)![0])
    .sort();

beforeAll(() => {
  db = openTestDatabase();
  db.query("INSERT INTO library_root (id, path, added_at) VALUES (1, 'C:\\lib', 0)").run();
  add('beach', 'Summer Beach Story', ['artist:hiten', 'parody:blue archive', 'language:english'], {
    pages: 40,
  });
  add('snow', '雪の日の思い出', ['artist:hitoshi', 'female:glasses', 'language:japanese'], {
    pages: 12,
  });
  add('city', 'City Lights', ['artist:someone', 'parody:original', 'female:glasses'], {
    pages: 25,
  });
  db.query('UPDATE gallery SET favorite = 1, rating = 5 WHERE id = ?').run(ids.city);
  saveProgress(db, ids.beach, 3);
  setInCollection(db, createCollection(db, 'Best of'), ids.snow, true);
});

describe('tokenize', () => {
  it('keeps quoted values together', () => {
    expect(tokenize('parody:"blue archive" -female:glasses "two words" plain')).toEqual([
      'parody:"blue archive"',
      '-female:glasses',
      '"two words"',
      'plain',
    ]);
  });
});

describe('searching', () => {
  it('finds file names, but not the library folder every gallery shares', () => {
    expect(find('snow.cbz')).toEqual(['snow']);
    expect(find('lib')).toEqual([]);
  });

  it('suggests tags for namespace aliases', () => {
    expect(listTags(db, { prefix: 'hit', namespace: 'a' }).map((tag) => tag.name)).toEqual([
      'hiten',
      'hitoshi',
    ]);
  });

  it('finds words anywhere in titles, including Japanese', () => {
    expect(find('beach')).toEqual(['beach']);
    expect(find('思い出')).toEqual(['snow']);
    expect(find('summer story')).toEqual(['beach']);
  });

  it('finds short words in titles', () => {
    expect(find('雪')).toEqual(['snow']);
  });

  it('finds tags, with namespaces, aliases and quotes', () => {
    expect(find('artist:hiten')).toEqual(['beach']);
    expect(find('a:hiten')).toEqual(['beach']);
    expect(find('parody:"blue archive"')).toEqual(['beach']);
    expect(find('tag:glasses')).toEqual(['city', 'snow']);
  });

  it('matches tag prefixes with a star', () => {
    expect(find('artist:hit*')).toEqual(['beach', 'snow']);
  });

  it('leaves out what is negated', () => {
    expect(find('-female:glasses')).toEqual(['beach']);
    expect(find('-beach')).toEqual(['city', 'snow']);
  });

  it('filters by status, numbers and collections', () => {
    expect(find('is:favorite')).toEqual(['city']);
    expect(find('is:reading')).toEqual(['beach']);
    expect(find('is:unread')).toEqual(['city', 'snow']);
    expect(find('rating>=4')).toEqual(['city']);
    expect(find('pages>20')).toEqual(['beach', 'city']);
    expect(find('pages<=12')).toEqual(['snow']);
    expect(find('in:"best of"')).toEqual(['snow']);
  });

  it('finds tag text with plain words too', () => {
    expect(find('glasses')).toEqual(['city', 'snow']);
  });

  it('hides missing galleries unless asked for them', () => {
    db.query('UPDATE gallery SET missing = 1 WHERE id = ?').run(ids.city);
    expect(find('glasses')).toEqual(['snow']);
    expect(find('is:missing')).toEqual(['city']);
    db.query('UPDATE gallery SET missing = 0 WHERE id = ?').run(ids.city);
  });

  it('keeps the sort order across pages, with each card complete', () => {
    const sorted = queryGalleries(db, { sort: 'title' }).items;
    expect(sorted.map((card) => card.title)).toEqual([
      'City Lights',
      'Summer Beach Story',
      '雪の日の思い出',
    ]);
    const [second] = queryGalleries(db, { sort: 'title', limit: 1, offset: 1 }).items;
    expect(second).toMatchObject({
      id: ids.beach,
      artists: 'hiten',
      language: 'english',
      pageCount: 40,
    });
    expect(queryGalleries(db, { query: 'nothing matches this' }).items).toEqual([]);
  });

  it('counts each doujin once per tag, leaving out missing ones', () => {
    const count = (namespace: string, name: string) =>
      listTags(db, { limit: 100 }).find((tag) => tag.namespace === namespace && tag.name === name)
        ?.count;
    try {
      // The same tag from a second source is still one doujin
      applyMetadata(db, ids.beach, 'ehentai', { tags: [parseTag('artist:hiten')!] });
      expect(count('artist', 'hiten')).toBe(1);
      expect(count('female', 'glasses')).toBe(2);

      db.query('UPDATE gallery SET missing = 1 WHERE id = ?').run(ids.snow);
      expect(count('female', 'glasses')).toBe(1);
      expect(count('artist', 'hitoshi')).toBeUndefined();
    } finally {
      // The other tests share this library
      db.query('UPDATE gallery SET missing = 0 WHERE id = ?').run(ids.snow);
      applyMetadata(db, ids.beach, 'ehentai', { tags: [] });
    }
  });

  it('pages through results with a total', () => {
    const first = queryGalleries(db, { sort: 'added', limit: 2 });
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    const random = queryGalleries(db, { sort: 'random', seed: 42 });
    expect(random.items).toHaveLength(3);
  });
});
