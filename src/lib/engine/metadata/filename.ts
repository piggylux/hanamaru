import {
  languageTag,
  languageTags,
  uniqueTags,
  normalizeTag,
  type Metadata,
  type Tag,
} from './tags.js';

/**
 * Reads the naming convention most doujins are shared with:
 *
 *   (Event) [Circle (Artist)] Title (Parody) [Language] [Translator] [Digital]
 *
 * Every part except the title is optional. Hentai@Home folders also end in the gallery's number,
 * as in `Title [1234567]`.
 */
export type FilenameMetadata = Metadata & { title: string; ehGidHint?: number };

/** Square-bracket notes that describe the edition rather than naming a translator */
const EDITION_TAGS: Record<string, Tag> = {
  digital: { namespace: 'other', name: 'digital' },
  dl版: { namespace: 'other', name: 'digital' },
  decensored: { namespace: 'other', name: 'uncensored' },
  uncensored: { namespace: 'other', name: 'uncensored' },
  無修正: { namespace: 'other', name: 'uncensored' },
  colorized: { namespace: 'other', name: 'colorized' },
  colored: { namespace: 'other', name: 'colorized' },
  'full color': { namespace: 'other', name: 'full color' },
  フルカラー: { namespace: 'other', name: 'full color' },
  textless: { namespace: 'other', name: 'textless' },
  無字: { namespace: 'other', name: 'textless' },
  ongoing: { namespace: 'other', name: 'ongoing' },
  incomplete: { namespace: 'other', name: 'incomplete' },
  'english translated': { namespace: 'language', name: 'english' },
};

/** Leading parentheses that name a kind of book, not the event it was sold at */
const BOOK_KINDS = /^(成年コミック|一般コミック|同人誌|同人CG集|アンソロジー|C\d+ ?おまけ)$/;

/** Trailing parentheses that are part of the title rather than a parody */
const NOT_PARODY =
  /^(part|vol|volume|ch|chapter|no|#|ep|episode|act|day)\.?\s*\d|^\d+$|^(zenpen|kouhen|jou|ge|chuu|前編|後編|上|下|中)$/i;

const ORIGINAL = /^(original|オリジナル)$/i;

/** Fullwidth and lenticular brackets, as used in Chinese and Japanese names */
function normalizeBrackets(text: string) {
  return text
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[［【〔]/g, '[')
    .replace(/[］】〕]/g, ']')
    .replace(/[｛]/g, '{')
    .replace(/[｝]/g, '}')
    .replace(/_/g, ' ');
}

function splitNames(text: string) {
  return text
    .split(/\s*(?:,|、|，|&|＆|\s\+\s)\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function parseFilename(raw: string): FilenameMetadata {
  let rest = normalizeBrackets(raw).replace(/\s+/g, ' ').trim();
  const tags: (Tag | undefined)[] = [];
  let ehGidHint: number | undefined;

  // (Event) at the start, sometimes more than one, such as (C99) (Reitaisai 20)
  for (let match; (match = /^\(([^()]*)\)\s*/.exec(rest));) {
    const event = match[1].trim();
    if (event && !BOOK_KINDS.test(event)) tags.push(normalizeTag('event', event));
    rest = rest.slice(match[0].length);
  }

  // [Circle (Artist)] or [Artist]
  const credit = /^\[([^\]]*)\]\s*/.exec(rest);
  if (credit) {
    rest = rest.slice(credit[0].length);
    const inner = credit[1].trim();
    const circle = /^(.*?)\s*\(([^()]+)\)$/.exec(inner);
    if (/^(anthology|アンソロジー|various)$/i.test(inner)) {
      tags.push({ namespace: 'other', name: 'anthology' });
    } else if (circle && circle[1]) {
      for (const name of splitNames(circle[1])) tags.push(normalizeTag('group', name));
      for (const name of splitNames(circle[2])) tags.push(normalizeTag('artist', name));
    } else {
      for (const name of splitNames(inner.replace(/^\((.*)\)$/, '$1'))) {
        tags.push(normalizeTag('artist', name));
      }
    }
  }

  // [Language], [Translator], [Digital] and friends at the end, read from the right
  for (let match; (match = /\s*(?:\[([^[\]]*)\]|\{([^{}]*)\})$/.exec(rest));) {
    rest = rest.slice(0, match.index);
    const note = (match[1] ?? match[2] ?? '').trim();
    if (match[1] === undefined) continue; // {Translator}
    const language =
      languageTag(note) ?? languageTag(note.replace(/\s*(translated|翻訳|翻译)$/i, ''));
    if (language) {
      tags.push(...languageTags(language));
    } else if (/^\d{5,}$/.test(note)) {
      ehGidHint = Number(note);
    } else {
      const edition = EDITION_TAGS[note.toLowerCase()];
      if (edition) tags.push(edition);
    }
  }

  // (Parody) at the end of the title
  const parody = /\s*\(([^()]+)\)$/.exec(rest);
  if (parody && parody.index > 0 && !NOT_PARODY.test(parody[1].trim())) {
    rest = rest.slice(0, parody.index);
    for (const name of splitNames(parody[1])) {
      if (!ORIGINAL.test(name)) tags.push(normalizeTag('parody', name));
    }
  }

  const title = rest.trim() || raw.trim();
  return { title, tags: uniqueTags(tags), ehGidHint };
}
