/** Types shared by the engine and the pages */

export type GalleryKind = 'folder' | 'zip';

export type ReaderMode = 'single' | 'double' | 'strip';
export type ReaderDirection = 'rtl' | 'ltr';
export type ReaderFit = 'contain' | 'width' | 'original';

export type ReaderPrefs = {
  mode: ReaderMode;
  /** Doujins read right to left, as printed in Japan */
  direction: ReaderDirection;
  fit: ReaderFit;
  /** In two-page mode, show the page after the cover alone, to fix spreads that pair wrongly */
  shift: boolean;
};

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  mode: 'single',
  direction: 'rtl',
  fit: 'contain',
  shift: false,
};

export type Tag = { namespace: string; name: string };

export type SortKey = 'added' | 'title' | 'read' | 'rating' | 'pages' | 'random';

/** What a library card shows */
export type GalleryCard = {
  id: number;
  title: string;
  artists: string | null;
  language: string | null;
  pageCount: number;
  lastPage: number;
  readCount: number;
  favorite: boolean;
  rating: number | null;
  missing: boolean;
  version: string;
};

export type GalleryDetail = {
  id: number;
  path: string;
  kind: GalleryKind;
  title: string;
  titleJpn: string | null;
  category: string | null;
  titleSource: string;
  pageCount: number;
  lastPage: number;
  lastReadAt: number | null;
  readCount: number;
  favorite: boolean;
  rating: number | null;
  missing: boolean;
  addedAt: number;
  version: string;
  ehGid: number | null;
  ehToken: string | null;
  tags: Tag[];
  collections: { id: number; name: string }[];
  readerPrefs: Partial<ReaderPrefs> | null;
};

export type PageInfo = { width: number | null; height: number | null };

export type ScanProgress = {
  running: boolean;
  phase: 'idle' | 'walking' | 'processing' | 'done' | 'failed';
  done: number;
  total: number;
  current?: string;
  added: number;
  updated: number;
  moved: number;
  missing: number;
  /** RAR and 7z archives, which the browser can't open */
  unsupported: number;
  errors: string[];
  finishedAt?: number;
};

/** What importing a backup did */
export type ImportResult = {
  /** Doujins already in the library that got their details back */
  restored: number;
  /** Doujins not found yet, restored when a scan finds them */
  waiting: number;
  /** Entries in the file that couldn't be read */
  skipped: number;
  collections: number;
};

export type AppEvent = { type: 'scan'; progress: ScanProgress } | { type: 'library' };
