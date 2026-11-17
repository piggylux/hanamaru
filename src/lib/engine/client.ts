/**
 * The page's side of the engine: it starts the worker, calls into it, answers the service
 * worker's requests for images, and asks for access to the library folders.
 */
import { error } from '@sveltejs/kit';

import { live } from '#lib/live.svelte.js';

import type { Api } from './api.js';
import type { Engine } from './context.js';
import { EngineError } from './errors.js';
import type { FolderEntry } from './files.js';
import { idbRoots } from './roots-idb.js';

type Remote = {
  [Name in keyof Api]: Api[Name] extends (engine: Engine, ...args: infer Args) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : never;
};

export { EngineError };

type Reply =
  | { id: number; result: unknown }
  | { id: number; error: { message: string; code?: string } }
  | { event: Parameters<typeof live.receive>[0] };

let worker: Worker | undefined;
/** Set when the worker failed before it ever answered: nothing can work then */
let broken: EngineError | undefined;
let answered = false;
let nextId = 0;
const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function call(method: string, args: unknown[]) {
  if (broken) return Promise.reject(broken);
  if (!worker) return Promise.reject(new EngineError('hanamaru has not started', 'not-started'));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, method, args });
  });
}

/** The engine's functions, called from the page: `await engine.gallery(12)` */
export const engine = new Proxy({} as Remote, {
  get: (_, method) =>
    // Not a promise: `await engine` and returning it from an async function look for `then`
    typeof method === 'symbol' || method === 'then'
      ? undefined
      : (...args: unknown[]) => call(method, args),
});

export type StartState =
  | { status: 'ready' }
  /** Not Chrome or Edge on a computer: no way to read folders */
  | { status: 'unsupported' }
  /** Open in another tab, which holds the database */
  | { status: 'busy' }
  | { status: 'failed'; message: string };

let starting: Promise<StartState> | undefined;

/** Starts the engine once; every page load waits on the same start */
export function startEngine() {
  starting ??= start();
  return starting;
}

export function isSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function' &&
    'serviceWorker' in navigator &&
    typeof navigator.locks?.request === 'function' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

async function start(): Promise<StartState> {
  if (!isSupported()) return { status: 'unsupported' };
  if (!(await holdLock())) return { status: 'busy' };

  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    answered = true;
    if ('event' in data) {
      live.receive(data.event);
      return;
    }
    const pending = waiting.get(data.id);
    if (!pending) return;
    waiting.delete(data.id);
    if ('error' in data) pending.reject(new EngineError(data.error.message, data.error.code));
    else pending.resolve(data.result);
  };
  // A worker that can't load (its script or SQLite's WebAssembly) or that crashes would leave
  // every call waiting forever: they fail instead, and the page says hanamaru couldn't start
  worker.onerror = (event) => {
    event.preventDefault();
    const failure = new EngineError(event.message || 'The engine stopped working', 'failed');
    if (!answered) broken = failure;
    for (const pending of waiting.values()) pending.reject(failure);
    waiting.clear();
  };

  answerImageRequests();
  try {
    await Promise.all([engine.ping(), serviceWorkerInControl()]);
  } catch (error) {
    return { status: 'failed', message: (error as Error).message };
  }
  // Without this, the browser may clear the library's data when the disk runs low
  void navigator.storage.persist?.();
  const scan = await engine.latestScan();
  if (scan) live.receive({ type: 'scan', progress: scan });
  void scanOnStart();
  // Browser tests reach the engine directly: they can't operate the folder picker
  if (import.meta.env.DEV) Object.assign(window, { __hanamaruEngine: engine });
  return { status: 'ready' };
}

/**
 * Looks for doujins added, moved or removed since the last visit, as soon as the browser allows
 * reading at least one library folder. Folders still waiting for access are left as they were.
 */
async function scanOnStart() {
  const folders = await idbRoots.all();
  if (folders.size > (await foldersNeedingAccess(folders)).length) await engine.scan();
}

/**
 * The database can be open in one tab only. The lock is held for as long as this tab is open,
 * and released by the browser when it closes.
 */
function holdLock() {
  return new Promise<boolean>((resolve) => {
    void navigator.locks.request('hanamaru-library', { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock ? new Promise<void>(() => {}) : undefined;
    });
  });
}

/**
 * Covers and pages are `/media/...` addresses. The service worker answers them by asking this
 * page, which asks the engine: images then load like any other, lazily and in the background.
 */
function answerImageRequests() {
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const port = event.ports[0];
    if (event.data?.type !== 'media' || !port) return;
    engine.media(event.data.url).then(
      (body) => port.postMessage(body ?? null),
      () => port.postMessage(null)
    );
  });
  navigator.serviceWorker.startMessages();
}

/** Waits until the service worker answers this page's requests, including after a hard reload */
async function serviceWorkerInControl() {
  const registration = await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  const controlled = new Promise((resolve) =>
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
  );
  registration.active?.postMessage('claim');
  await Promise.race([controlled, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

/** Library folders the browser needs to be allowed to read again, by their ids */
export async function foldersNeedingAccess(folders?: Map<number, FileSystemDirectoryHandle>) {
  const needing: number[] = [];
  for (const [id, folder] of folders ?? (await idbRoots.all())) {
    if ((await folder.queryPermission({ mode: 'read' })) !== 'granted') needing.push(id);
  }
  return needing;
}

/**
 * Asks for access to every library folder; must follow a click. The browser may refuse to ask
 * (a second folder can find the click already used), which counts as not allowed: the page then
 * says so and the button can be pressed again.
 */
export async function allowAccess() {
  let allowed = true;
  for (const folder of (await idbRoots.all()).values()) {
    try {
      if ((await folder.queryPermission({ mode: 'read' })) === 'granted') continue;
      allowed = (await folder.requestPermission({ mode: 'read' })) === 'granted' && allowed;
    } catch {
      allowed = false;
    }
  }
  return allowed;
}

/** Opens the browser's folder picker. Undefined when it's closed without choosing */
export async function pickFolder() {
  try {
    // The browser's handle has everything hanamaru uses from a folder (see `files.ts`)
    const folder = await window.showDirectoryPicker({ id: 'hanamaru-library', mode: 'read' });
    return folder as unknown as FolderEntry;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return undefined;
    throw error;
  }
}

/** The engine, for a page's load: nothing can show without it, so its absence is the error page */
export async function readyEngine() {
  const state = await startEngine();
  if (state.status !== 'ready') {
    error(503, {
      message: state.status === 'failed' ? state.message : 'hanamaru could not start',
      code: state.status,
    });
  }
  return engine;
}

/** A doujin's id from the address; anything else is a page that doesn't exist */
export function idParam(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) error(404, 'This doujin is not in the library');
  return id;
}

/** The engine's answer, with "not in the library" shown as the not-found page */
export async function orNotFound<T>(work: Promise<T>) {
  try {
    return await work;
  } catch (failure) {
    if (failure instanceof EngineError && failure.code === 'not-found') error(404, failure.message);
    throw failure;
  }
}
