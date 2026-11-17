import { readEntry, readEntryHead, type GallerySource } from './archive/index.js';
import type { Engine } from './context.js';
import { imageSize } from './image-size.js';
import { pageInfos, pageName, setPageSize } from './library.js';
import { PAGE_THUMB_WIDTH, pageThumbPath, writeThumbnail } from './thumbs.js';

const measuring = new Map<number, Promise<void>>();

/**
 * Every page's size, which two-page mode needs to keep wide spreads on their own. Measured once,
 * the first time the reader opens a gallery, from each image's header.
 */
export async function ensurePageSizes(engine: Engine, gallery: GallerySource) {
  const pending = measuring.get(gallery.id);
  if (pending) return pending;
  const work = (async () => {
    const infos = pageInfos(engine.db, gallery.id);
    const todo = infos.flatMap((info, index) => (info.width === null ? [index] : []));
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, todo.length) }, async () => {
        while (next < todo.length) {
          const index = todo[next++];
          const name = pageName(engine.db, gallery.id, index);
          if (!name) continue;
          let size;
          try {
            // The header is usually at the very start; the whole page is decoded only if it isn't
            size =
              imageSize(await readEntryHead(engine, gallery, name)) ??
              (await engine.images.size(await readEntry(engine, gallery, name)));
          } catch {
            // Unreadable for now (access not allowed yet, file busy): measured again next time
            continue;
          }
          // 0 × 0 marks an image that can't be decoded, so it isn't measured again
          setPageSize(engine.db, gallery.id, index, size?.width ?? 0, size?.height ?? 0);
        }
      })
    );
  })();
  measuring.set(gallery.id, work);
  try {
    await work;
  } finally {
    measuring.delete(gallery.id);
  }
}

const thumbnailing = new Map<string, Promise<Blob | undefined>>();

/** A page's small preview for the doujin's page, made the first time it's asked for */
export async function pageThumbnail(engine: Engine, gallery: GallerySource, index: number) {
  const output = pageThumbPath(gallery.id, index);
  const saved = await engine.store.read(output);
  if (saved) return saved;
  const key = `${gallery.id}:${index}`;
  let work = thumbnailing.get(key);
  if (!work) {
    work = (async () => {
      const name = pageName(engine.db, gallery.id, index);
      if (!name) return undefined;
      const page = await readEntry(engine, gallery, name);
      if (!(await writeThumbnail(engine, page, output, PAGE_THUMB_WIDTH))) return undefined;
      return engine.store.read(output);
    })().finally(() => thumbnailing.delete(key));
    thumbnailing.set(key, work);
  }
  return work;
}
