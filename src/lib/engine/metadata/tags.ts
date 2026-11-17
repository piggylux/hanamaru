export type Tag = { namespace: string; name: string };

/** Where a gallery's details came from, from most to least trusted */
export const SOURCES = ['manual', 'ehentai', 'sidecar', 'filename'] as const;
export type Source = (typeof SOURCES)[number];

/** Metadata a source found for a gallery; anything left out is left as it was */
export type Metadata = {
  title?: string;
  titleJpn?: string;
  category?: string;
  tags: Tag[];
  ehGid?: number;
  ehToken?: string;
};

/** E-Hentai's namespaces, plus `event` for conventions such as (C99) in file names */
export const NAMESPACES = [
  'artist',
  'group',
  'parody',
  'character',
  'female',
  'male',
  'mixed',
  'language',
  'cosplayer',
  'event',
  'other',
] as const;

/** Short names people type in searches, as on E-Hentai */
export const NAMESPACE_ALIASES: Record<string, string> = {
  a: 'artist',
  g: 'group',
  circle: 'group',
  p: 'parody',
  series: 'parody',
  c: 'character',
  char: 'character',
  f: 'female',
  m: 'male',
  x: 'mixed',
  l: 'language',
  lang: 'language',
  cos: 'cosplayer',
  e: 'event',
  o: 'other',
  misc: 'other',
};

/**
 * Tags are compared in lower case with single spaces, as E-Hentai writes them, so "Hiten" from a
 * file name and "hiten" from E-Hentai are one tag
 */
export function normalizeTag(namespace: string, name: string): Tag | undefined {
  const cleanName = name.replace(/\s+/g, ' ').trim().toLowerCase();
  let cleanNamespace = namespace.replace(/\s+/g, ' ').trim().toLowerCase() || 'other';
  cleanNamespace = NAMESPACE_ALIASES[cleanNamespace] ?? cleanNamespace;
  if (!cleanName) return undefined;
  return { namespace: cleanNamespace, name: cleanName };
}

/** Reads "namespace:name" (or a bare name, which goes under `other`) */
export function parseTag(text: string): Tag | undefined {
  const colon = text.indexOf(':');
  return colon > 0
    ? normalizeTag(text.slice(0, colon), text.slice(colon + 1))
    : normalizeTag('other', text);
}

export function uniqueTags(tags: (Tag | undefined)[]): Tag[] {
  const seen = new Map<string, Tag>();
  for (const tag of tags) {
    if (tag) seen.set(`${tag.namespace}:${tag.name}`, tag);
  }
  return [...seen.values()];
}

/** Language names and codes, mapped to E-Hentai's language tags */
const LANGUAGES: Record<string, string> = {
  english: 'english',
  eng: 'english',
  en: 'english',
  英訳: 'english',
  japanese: 'japanese',
  jp: 'japanese',
  ja: 'japanese',
  日本語: 'japanese',
  chinese: 'chinese',
  zh: 'chinese',
  中国翻訳: 'chinese',
  中国語: 'chinese',
  中文: 'chinese',
  汉化: 'chinese',
  漢化: 'chinese',
  korean: 'korean',
  ko: 'korean',
  한국어: 'korean',
  spanish: 'spanish',
  español: 'spanish',
  es: 'spanish',
  french: 'french',
  français: 'french',
  fr: 'french',
  german: 'german',
  deutsch: 'german',
  de: 'german',
  russian: 'russian',
  русский: 'russian',
  ru: 'russian',
  portuguese: 'portuguese',
  português: 'portuguese',
  'portuguese-br': 'portuguese',
  'português-br': 'portuguese',
  pt: 'portuguese',
  italian: 'italian',
  italiano: 'italian',
  it: 'italian',
  vietnamese: 'vietnamese',
  'tiếng việt': 'vietnamese',
  vi: 'vietnamese',
  thai: 'thai',
  ภาษาไทย: 'thai',
  th: 'thai',
  indonesian: 'indonesian',
  'bahasa indonesia': 'indonesian',
  id: 'indonesian',
  polish: 'polish',
  polski: 'polish',
  pl: 'polish',
};

export function languageTag(text: string) {
  return LANGUAGES[text.trim().toLowerCase()];
}

/** Language tags, plus `translated` for anything that isn't Japanese, as E-Hentai tags them */
export function languageTags(language: string): Tag[] {
  return language === 'japanese'
    ? [{ namespace: 'language', name: language }]
    : [
        { namespace: 'language', name: language },
        { namespace: 'language', name: 'translated' },
      ];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** E-Hentai's titles and XML sidecars escape characters as HTML entities */
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** E-Hentai and ExHentai gallery addresses: https://e-hentai.org/g/{gid}/{token}/ */
export const GALLERY_URL = /https?:\/\/(?:e-|ex)hentai\.org\/g\/(\d+)\/([0-9a-f]{10})/gi;

export function findGalleryUrl(text: string) {
  const match = new RegExp(GALLERY_URL.source, 'i').exec(text);
  return match ? { ehGid: Number(match[1]), ehToken: match[2].toLowerCase() } : undefined;
}
