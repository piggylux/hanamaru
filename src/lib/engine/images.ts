/** A file name's extension, lowercase and with its dot, as Node's `extname` gives it */
export function extname(name: string) {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/** Page formats the browser can show. JPEG XL is left out: Chromium browsers can't display it */
const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

export const ARCHIVE_KINDS = {
  '.zip': 'zip',
  '.cbz': 'zip',
} as const;

/** Archives the browser has no built-in way to open: a scan counts them and moves on */
const UNSUPPORTED_ARCHIVES = new Set(['.rar', '.cbr', '.7z', '.cb7']);

export type ArchiveKind = (typeof ARCHIVE_KINDS)[keyof typeof ARCHIVE_KINDS];
export type GalleryKind = 'folder' | ArchiveKind;

export function imageType(name: string) {
  return IMAGE_TYPES[extname(name)];
}

export const isUnsupportedArchive = (name: string) => UNSUPPORTED_ARCHIVES.has(extname(name));

/**
 * Whether a name inside an archive stays inside it. Names come from the archive itself, so a
 * crafted one could point outside the folder it's unpacked into ("../", "C:\", "/").
 */
export function isContainedName(path: string) {
  if (/^([a-z]:|[\\/])/i.test(path)) return false;
  return !path.split(/[\\/]/).includes('..');
}

/** Whether a file is a page: an image that isn't a hidden file or a macOS resource fork */
export function isPage(path: string) {
  if (!isContainedName(path)) return false;
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1) ?? '';
  if (parts.some((part) => part === '__MACOSX' || part.startsWith('.'))) return false;
  return imageType(name) !== undefined;
}

export function archiveKind(name: string): ArchiveKind | undefined {
  return ARCHIVE_KINDS[extname(name) as keyof typeof ARCHIVE_KINDS];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Orders names the way people number pages: 2.jpg before 10.jpg */
export function naturalCompare(a: string, b: string) {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
