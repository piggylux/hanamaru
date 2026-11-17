/**
 * The engine's worker: it owns the database, reads the library folders and makes thumbnails, so
 * none of that work slows the page down. The page talks to it through `client.ts`.
 */
import type { AppEvent } from '#lib/types.js';

import { api } from './api.js';
import { browserCodec } from './codec.js';
import type { Engine } from './context.js';
import { opfsStore } from './opfs.js';
import { idbRoots } from './roots-idb.js';
import { openBrowserDatabase } from './sqlite.js';

type Call = { id: number; method: string; args: unknown[] };

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<Call>) => void) | null;
};

const engine: Promise<Engine> = openBrowserDatabase().then((db) => ({
  db,
  roots: idbRoots,
  store: opfsStore,
  images: browserCodec,
  emit: (event: AppEvent) => scope.postMessage({ event }),
}));
// A failure to start reaches the page with its first call
engine.catch(() => {});

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    const run = api[method as keyof typeof api] as
      | ((engine: Engine, ...args: unknown[]) => unknown)
      | undefined;
    if (!run) throw new Error(`The engine has no "${method}"`);
    scope.postMessage({ id, result: await run(await engine, ...args) });
  } catch (error) {
    scope.postMessage({
      id,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string }).code,
      },
    });
  }
};
