import type { AppEvent } from '#lib/types.js';

import type { Database } from './db.js';
import type { BlobStore, RootStore } from './files.js';

/** Turns pages into thumbnails and measures them: the browser's canvas, or a stand-in in tests */
export interface ImageCodec {
  thumbnail(
    input: Blob,
    width: number,
    options?: { frontCover?: boolean }
  ): Promise<Blob | undefined>;
  size(input: Blob): Promise<{ width: number; height: number } | undefined>;
}

/** Everything the engine works with, made once when it starts */
export type Engine = {
  db: Database;
  roots: RootStore;
  store: BlobStore;
  images: ImageCodec;
  /** Tells the open page about background work: scans and library changes */
  emit(event: AppEvent): void;
};
