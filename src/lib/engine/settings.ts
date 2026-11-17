import {
  DEFAULT_READER_PREFS,
  type ReaderDirection,
  type ReaderFit,
  type ReaderMode,
  type ReaderPrefs,
} from '#lib/types.js';

import type { Database } from './db.js';

const MODES: ReaderMode[] = ['single', 'double', 'strip'];
const DIRECTIONS: ReaderDirection[] = ['rtl', 'ltr'];
const FITS: ReaderFit[] = ['contain', 'width', 'original'];

const pick = <T extends string>(options: T[], value: unknown, fallback: T) =>
  options.includes(value as T) ? (value as T) : fallback;

/** Reader settings from a request or an imported file, with anything unknown set to the default */
export function cleanReaderPrefs(value: unknown): ReaderPrefs {
  const prefs = (value && typeof value === 'object' ? value : {}) as Partial<ReaderPrefs>;
  return {
    mode: pick(MODES, prefs.mode, DEFAULT_READER_PREFS.mode),
    direction: pick(DIRECTIONS, prefs.direction, DEFAULT_READER_PREFS.direction),
    fit: pick(FITS, prefs.fit, DEFAULT_READER_PREFS.fit),
    shift: prefs.shift === true,
  };
}

export type Settings = {
  readerDefaults: ReaderPrefs;
};

export const DEFAULT_SETTINGS: Settings = {
  readerDefaults: DEFAULT_READER_PREFS,
};

export function getSetting<K extends keyof Settings>(db: Database, key: K): Settings[K] {
  const row = db
    .query<{ value: string }, [string]>('SELECT value FROM setting WHERE key = ?')
    .get(key);
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    const value = JSON.parse(row.value) as Settings[K];
    if (key === 'readerDefaults') {
      return { ...DEFAULT_READER_PREFS, ...(value as ReaderPrefs) } as Settings[K];
    }
    return value;
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export function setSetting<K extends keyof Settings>(db: Database, key: K, value: Settings[K]) {
  db.query(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}
