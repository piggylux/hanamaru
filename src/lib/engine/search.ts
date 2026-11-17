import type { SortKey } from '#lib/types.js';

import { NAMESPACE_ALIASES, NAMESPACES } from './metadata/tags.js';

/**
 * Turns what someone types in the search box into SQL conditions on `gallery g`. It follows
 * E-Hentai's style:
 *
 *   blue archive            title, Japanese title, tags or path contain both words
 *   "summer sea"            ...contain the phrase
 *   artist:hiten            has the tag (aliases such as a:, p:, f: work too)
 *   parody:"blue archive"   quotes allow spaces
 *   tag:glasses             the tag in any namespace
 *   artist:hit*             tags starting with "hit"
 *   -female:glasses         leaves out galleries with the tag (works on anything)
 *   is:favorite             also unread, reading, read, missing, rated
 *   rating>=4  pages<30     numbers compare with :, =, >, <, >=, <=
 *   in:"My collection"      galleries in a collection
 */
export type ParsedSearch = { where: string[]; params: (string | number)[] };

const TAG_NAMESPACES = new Set<string>([...NAMESPACES, 'tag']);

export function tokenize(query: string) {
  const tokens: string[] = [];
  const pattern = /(-?)([^\s":]+:)?"([^"]*)"?|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    if (match[4] !== undefined) tokens.push(match[4]);
    else tokens.push(`${match[1]}${match[2] ?? ''}"${match[3]}"`);
  }
  return tokens;
}

const unquote = (value: string) => value.replace(/^"(.*)"$/, '$1');

/** A term for the trigram index: a phrase, with quotes doubled */
const ftsPhrase = (text: string) => `"${text.replaceAll('"', '""')}"`;

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

export function parseSearch(query: string): ParsedSearch {
  const where: string[] = [];
  const params: (string | number)[] = [];
  let includeMissing = false;

  for (const token of tokenize(query.trim())) {
    const negate = token.startsWith('-') && token.length > 1;
    const body = negate ? token.slice(1) : token;
    const not = negate ? 'NOT ' : '';

    const comparison = /^(rating|pages)(:|=|>=|<=|>|<)(\d+)$/i.exec(body);
    if (comparison) {
      const column = comparison[1].toLowerCase() === 'rating' ? 'g.rating' : 'g.page_count';
      const operator = comparison[2] === ':' ? '=' : comparison[2];
      where.push(`${not}(${column} ${operator} ?)`);
      params.push(Number(comparison[3]));
      continue;
    }

    const colon = body.indexOf(':');
    const prefix = colon > 0 ? body.slice(0, colon).toLowerCase() : '';
    const value =
      colon > 0
        ? unquote(body.slice(colon + 1))
            .trim()
            .toLowerCase()
        : '';

    if (prefix === 'is' && value) {
      const condition = STATUS[value];
      if (condition) {
        if (value === 'missing') includeMissing = !negate;
        where.push(`${not}(${condition})`);
        continue;
      }
    }

    if (prefix === 'in' && value) {
      where.push(
        `${not}(g.id IN (SELECT cg.gallery_id FROM collection_gallery cg
           JOIN collection c ON c.id = cg.collection_id WHERE c.name = ? COLLATE NOCASE))`
      );
      params.push(value);
      continue;
    }

    if (prefix === 'title' && value) {
      where.push(
        `${not}(g.title LIKE ? ESCAPE '\\' OR coalesce(g.title_jpn, '') LIKE ? ESCAPE '\\')`
      );
      params.push(likePattern(value), likePattern(value));
      continue;
    }

    const namespace = NAMESPACE_ALIASES[prefix] ?? prefix;
    if (prefix && value && TAG_NAMESPACES.has(namespace)) {
      const prefixMatch = value.endsWith('*');
      const name = prefixMatch ? value.slice(0, -1) : value;
      const conditions: string[] = [];
      if (namespace !== 'tag') {
        conditions.push('t.namespace = ?');
        params.push(namespace);
      }
      if (prefixMatch) {
        conditions.push(`t.name LIKE ? ESCAPE '\\'`);
        params.push(`${name.replace(/[\\%_]/g, '\\$&')}%`);
      } else {
        conditions.push('t.name = ?');
        params.push(name);
      }
      where.push(
        `${not}(g.id IN (SELECT gt.gallery_id FROM gallery_tag gt JOIN tag t ON t.id = gt.tag_id
           WHERE ${conditions.join(' AND ')}))`
      );
      continue;
    }

    // Plain words. The trigram index needs three characters; shorter words search the titles
    const text = unquote(body).trim();
    if (!text) continue;
    if ([...text].length >= 3) {
      where.push(`${not}(g.id IN (SELECT rowid FROM gallery_fts WHERE gallery_fts MATCH ?))`);
      params.push(ftsPhrase(text));
    } else {
      where.push(
        `${not}(g.title LIKE ? ESCAPE '\\' OR coalesce(g.title_jpn, '') LIKE ? ESCAPE '\\')`
      );
      params.push(likePattern(text), likePattern(text));
    }
  }

  if (!includeMissing && !where.some((condition) => condition.includes('g.missing = 1'))) {
    where.push('g.missing = 0');
  }
  return { where, params };
}

const STATUS: Record<string, string> = {
  favorite: 'g.favorite = 1',
  fav: 'g.favorite = 1',
  unread: 'g.read_count = 0 AND g.last_page = 0',
  reading: 'g.last_page > 0 AND g.last_page < g.page_count - 1',
  read: 'g.read_count > 0',
  missing: 'g.missing = 1',
  rated: 'g.rating IS NOT NULL',
};

export const SORTS: Record<SortKey, string> = {
  added: 'g.added_at DESC, g.id DESC',
  title: 'g.title COLLATE NOCASE ASC, g.id ASC',
  read: 'g.last_read_at DESC NULLS LAST, g.added_at DESC, g.id DESC',
  rating: 'g.rating DESC NULLS LAST, g.added_at DESC, g.id DESC',
  pages: 'g.page_count DESC, g.id DESC',
  // A fixed shuffle for each seed, so scrolling further keeps the same order
  random: '((g.id * 2654435761 + ?) % 4294967296), g.id',
};

export function isSortKey(value: string | null): value is SortKey {
  return value !== null && value in SORTS;
}
