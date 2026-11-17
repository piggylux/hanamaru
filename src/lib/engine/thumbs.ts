import type { Engine } from './context.js';

export const COVER_WIDTH = 400;
export const PAGE_THUMB_WIDTH = 240;

/** A page wider than this is a spread, or a wraparound cover */
export const WIDE = 1.2;

/** Where thumbnails are kept in the site's private storage */
export const coverPath = (galleryId: number) => `thumbs/covers/${galleryId}.webp`;

export const pageThumbPath = (galleryId: number, index: number) =>
  `thumbs/pages/${galleryId}/${index}.webp`;

export async function removeThumbnails(engine: Engine, galleryId: number) {
  await engine.store.remove(coverPath(galleryId));
  await engine.store.remove(`thumbs/pages/${galleryId}`);
}

/**
 * Saves a small image of a page. When `frontCover` is set and the page is a wraparound cover,
 * only its right half is kept: the front of a right-to-left book. Returns false when the image
 * can't be decoded, so the page shows a placeholder instead.
 */
export async function writeThumbnail(
  engine: Engine,
  input: Blob,
  output: string,
  width: number,
  options: { frontCover?: boolean } = {}
) {
  const thumbnail = await engine.images.thumbnail(input, width, options);
  if (!thumbnail) return false;
  await engine.store.write(output, thumbnail);
  return true;
}
