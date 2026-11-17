import {
  decodeEntities,
  findGalleryUrl,
  languageTag,
  languageTags,
  normalizeTag,
  parseTag,
  uniqueTags,
  type Metadata,
  type Tag,
} from './tags.js';

/**
 * Files that download tools save next to (or inside) a doujin, describing it:
 * - ComicInfo.xml, read by most comic readers
 * - info.json from gallery-dl
 * - galleryinfo.txt from Hentai@Home, and info.txt from E-Hentai downloader scripts
 */
export const SIDECAR_NAMES = ['comicinfo.xml', 'info.json', 'galleryinfo.txt', 'info.txt'];

export function isSidecar(name: string) {
  return SIDECAR_NAMES.includes(name.split('/').at(-1)!.toLowerCase());
}

export function parseSidecar(name: string, text: string): Metadata | undefined {
  const file = name.split(/[\\/]/).at(-1)!.toLowerCase();
  try {
    if (file.endsWith('.xml')) return parseComicInfo(text);
    if (file.endsWith('.json')) return parseGalleryDl(JSON.parse(text));
    if (file === 'galleryinfo.txt') return parseGalleryInfo(text);
    if (file.endsWith('.txt')) return parseInfoTxt(text);
  } catch {
    // A sidecar that can't be read adds nothing
  }
  return undefined;
}

/** Several sidecars for one gallery: the first to name a title wins, and tags add up */
export function combineSidecars(found: Metadata[]): Metadata | undefined {
  if (!found.length) return undefined;
  const combined: Metadata = { tags: [] };
  for (const metadata of found) {
    combined.title ??= metadata.title;
    combined.titleJpn ??= metadata.titleJpn;
    combined.category ??= metadata.category;
    if (combined.ehGid === undefined && metadata.ehGid !== undefined) {
      combined.ehGid = metadata.ehGid;
      combined.ehToken = metadata.ehToken;
    }
    combined.tags.push(...metadata.tags);
  }
  combined.tags = uniqueTags(combined.tags);
  return combined;
}

function xmlField(xml: string, field: string) {
  const match = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`, 'i').exec(xml);
  const value = match
    ? decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim()
    : '';
  return value || undefined;
}

function list(value: string | undefined) {
  return (value ?? '')
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseComicInfo(xml: string): Metadata {
  const tags: (Tag | undefined)[] = [];
  for (const field of ['Writer', 'Penciller', 'Inker', 'CoverArtist']) {
    for (const name of list(xmlField(xml, field))) tags.push(normalizeTag('artist', name));
  }
  for (const name of list(xmlField(xml, 'Teams'))) tags.push(normalizeTag('group', name));
  for (const name of list(xmlField(xml, 'Characters'))) tags.push(normalizeTag('character', name));
  for (const tag of [...list(xmlField(xml, 'Tags')), ...list(xmlField(xml, 'Genre'))]) {
    tags.push(parseTag(tag));
  }
  const language = languageTag(xmlField(xml, 'LanguageISO') ?? '');
  if (language) tags.push(...languageTags(language));
  const web = xmlField(xml, 'Web');
  return {
    title: xmlField(xml, 'Title'),
    tags: uniqueTags(tags),
    ...(web ? findGalleryUrl(web) : undefined),
  };
}

type GalleryDlInfo = Record<string, unknown>;

/** gallery-dl's E-Hentai metadata, whichever of its layouts the file uses */
export function parseGalleryDl(info: GalleryDlInfo): Metadata {
  const text = (key: string) => {
    const value = info[key];
    return typeof value === 'string' && value.trim() ? decodeEntities(value.trim()) : undefined;
  };
  const tags: (Tag | undefined)[] = [];
  const rawTags = info.tags;
  if (Array.isArray(rawTags)) {
    for (const tag of rawTags) if (typeof tag === 'string') tags.push(parseTag(tag));
  } else if (rawTags && typeof rawTags === 'object') {
    for (const [namespace, names] of Object.entries(rawTags)) {
      if (Array.isArray(names)) {
        for (const name of names)
          if (typeof name === 'string') tags.push(normalizeTag(namespace, name));
      }
    }
  }
  for (const [key, value] of Object.entries(info)) {
    const namespace = /^tags_(\w+)$/.exec(key)?.[1];
    if (namespace && Array.isArray(value)) {
      for (const name of value)
        if (typeof name === 'string') tags.push(normalizeTag(namespace, name));
    }
  }
  const language = languageTag(text('lang') ?? text('language') ?? '');
  if (language) tags.push(...languageTags(language));

  const gid = Number(info.gid ?? info.gallery_id);
  const token = text('token') ?? text('gallery_token');
  const fromUrl = findGalleryUrl(text('url') ?? text('gallery_url') ?? '');
  // gallery-dl's own `category` is the site it downloaded from, not E-Hentai's category
  const category = text('eh_category') ?? text('type');
  return {
    title: text('title'),
    titleJpn: text('title_jpn'),
    category,
    tags: uniqueTags(tags),
    ...(Number.isInteger(gid) && gid > 0 && token && /^[0-9a-f]{10}$/i.test(token)
      ? { ehGid: gid, ehToken: token.toLowerCase() }
      : fromUrl),
  };
}

/**
 * Hentai@Home's galleryinfo.txt:
 *
 *   Title:       ...
 *   Upload Time: ...
 *   Tags:        artist:foo, female:bar
 */
export function parseGalleryInfo(text: string): Metadata {
  const field = (name: string) =>
    new RegExp(`^${name}:\\s*(.*)$`, 'mi').exec(text)?.[1]?.trim() || undefined;
  return {
    title: field('Title'),
    tags: uniqueTags(list(field('Tags')).map(parseTag)),
    ...findGalleryUrl(text),
  };
}

/**
 * The info.txt E-Hentai downloader scripts write: the title, the Japanese title and the gallery
 * address on the first lines, then tag groups as `> namespace: tag, tag`
 */
export function parseInfoTxt(text: string): Metadata {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const urlLine = lines.findIndex((line) => findGalleryUrl(line));
  const heading = lines.slice(0, urlLine >= 0 ? urlLine : 2).filter(Boolean);
  const tags: (Tag | undefined)[] = [];
  for (const line of lines) {
    const group = /^>\s*([\w ]+):\s*(.+)$/.exec(line);
    if (group) for (const name of list(group[2])) tags.push(normalizeTag(group[1], name));
  }
  const category = /^Category:\s*(.+)$/im.exec(text)?.[1]?.trim();
  const language = /^Language:\s*(\w+)/im.exec(text)?.[1];
  const languageName = language ? languageTag(language) : undefined;
  if (languageName) tags.push(...languageTags(languageName));
  return {
    title: heading[0],
    titleJpn: heading[1],
    category,
    tags: uniqueTags(tags),
    ...(urlLine >= 0 ? findGalleryUrl(lines[urlLine]) : undefined),
  };
}
