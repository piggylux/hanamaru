/**
 * Names as people write them. Tags are stored in lower case, as E-Hentai keeps them, which reads
 * well in a tag list but not as a credit: "artist a" becomes "Artist A".
 */
export function displayName(name: string) {
  return name.replace(/(^|[\s(/-])(\p{Ll})/gu, (_, before: string, letter: string) => {
    return before + letter.toUpperCase();
  });
}

/** "1 doujin", "2 doujins" */
export function count(value: number, one: string, many = `${one}s`) {
  return `${value.toLocaleString()} ${value === 1 ? one : many}`;
}

const LANGUAGE_CODES: Record<string, string> = {
  english: 'EN',
  japanese: 'JP',
  chinese: 'ZH',
  korean: 'KO',
  spanish: 'ES',
  french: 'FR',
  german: 'DE',
  russian: 'RU',
  portuguese: 'PT',
  italian: 'IT',
  vietnamese: 'VI',
  thai: 'TH',
  indonesian: 'ID',
  polish: 'PL',
};

/** A short code for a language tag, for the corner of a cover */
export function languageCode(language: string) {
  return LANGUAGE_CODES[language] ?? language.slice(0, 2).toUpperCase();
}
