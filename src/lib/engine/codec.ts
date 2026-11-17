import type { ImageCodec } from './context.js';
import { WIDE } from './thumbs.js';

/**
 * Thumbnails made with the browser's own image decoding, off the page in the engine's worker.
 * Photos are turned upright from their EXIF orientation, as the browser shows them.
 */
export const browserCodec: ImageCodec = {
  async thumbnail(input, width, { frontCover = false } = {}) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(input);
    } catch {
      return undefined;
    }
    try {
      // The front of a wraparound cover is its right half, as for a right-to-left book
      const wraparound = frontCover && bitmap.width > bitmap.height * WIDE;
      const left = wraparound ? Math.floor(bitmap.width / 2) : 0;
      const sourceWidth = bitmap.width - left;
      const scale = Math.min(1, width / sourceWidth);
      const outWidth = Math.max(1, Math.round(sourceWidth * scale));
      const outHeight = Math.max(1, Math.round(bitmap.height * scale));
      const resized = await createImageBitmap(bitmap, left, 0, sourceWidth, bitmap.height, {
        resizeWidth: outWidth,
        resizeHeight: outHeight,
        resizeQuality: 'high',
      });
      try {
        const canvas = new OffscreenCanvas(outWidth, outHeight);
        canvas.getContext('2d')!.drawImage(resized, 0, 0);
        return await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
      } finally {
        resized.close();
      }
    } catch {
      return undefined;
    } finally {
      bitmap.close();
    }
  },

  async size(input) {
    try {
      const bitmap = await createImageBitmap(input);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return undefined;
    }
  },
};
