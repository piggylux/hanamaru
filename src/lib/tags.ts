import type { Tag } from '#lib/types.js';

/** The order tag groups appear in on a gallery's page */
const ORDER = [
  'language',
  'parody',
  'character',
  'group',
  'artist',
  'cosplayer',
  'event',
  'male',
  'female',
  'mixed',
  'other',
];

export function groupTags(tags: Tag[]) {
  const groups = new Map<string, string[]>();
  for (const tag of tags) {
    const names = groups.get(tag.namespace) ?? [];
    names.push(tag.name);
    groups.set(tag.namespace, names);
  }
  const rank = (namespace: string) => {
    const index = ORDER.indexOf(namespace);
    return index < 0 ? ORDER.length : index;
  };
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([namespace, names]) => ({ namespace, names: names.sort() }));
}

/** One tag per line, as the edit dialog shows them */
export function tagsToText(tags: Tag[]) {
  return groupTags(tags)
    .flatMap((group) => group.names.map((name) => `${group.namespace}:${name}`))
    .join('\n');
}

export function textToTags(text: string) {
  return text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
}
