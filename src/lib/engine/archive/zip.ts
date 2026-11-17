/**
 * A small ZIP reader that only looks at what it needs: the central directory at the end of the
 * file, then each page's own bytes. Pages are found by their offset, so opening page 30 of a
 * 300 MB archive reads about 1 MB. It works on a `Blob`, which is what the browser hands out for
 * a file on disk, so reading a slice never loads the rest.
 */
export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  encrypted: boolean;
};

/** Compression or encryption ZIP allows but this reader doesn't handle */
export class UnsupportedZipError extends Error {}

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END_OF_DIRECTORY = 0x06064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const UTF8_NAMES = 0x800;
const MAX = 0xffffffff;

export async function readZipDirectory(file: Blob): Promise<ZipEntry[]> {
  const { size } = file;
  // The end record is 22 bytes plus a comment of up to 64 KB, with a 20-byte ZIP64 locator before it
  const tailLength = Math.min(size, 22 + 0xffff + 20);
  const tail = await readAt(file, size - tailLength, tailLength);

  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP archive');

  let count = tail.getUint16(end + 10, true);
  let directorySize = tail.getUint32(end + 12, true);
  let directoryOffset = tail.getUint32(end + 16, true);
  const locator = end - 20;
  if (locator >= 0 && tail.getUint32(locator, true) === ZIP64_LOCATOR) {
    const zip64 = await readAt(file, Number(tail.getBigUint64(locator + 8, true)), 56);
    if (zip64.getUint32(0, true) !== ZIP64_END_OF_DIRECTORY)
      throw new Error('Broken ZIP64 archive');
    count = Number(zip64.getBigUint64(32, true));
    directorySize = Number(zip64.getBigUint64(40, true));
    directoryOffset = Number(zip64.getBigUint64(48, true));
  }

  const directory = await readAt(file, directoryOffset, directorySize);
  const bytes = new Uint8Array(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count && at + 46 <= directory.byteLength; i++) {
    if (directory.getUint32(at, true) !== DIRECTORY_ENTRY) break;
    const flags = directory.getUint16(at + 8, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    const entry: ZipEntry = {
      name: '',
      method: directory.getUint16(at + 10, true),
      compressedSize: directory.getUint32(at + 20, true),
      size: directory.getUint32(at + 24, true),
      localHeaderOffset: directory.getUint32(at + 42, true),
      encrypted: (flags & 1) !== 0,
    };
    readZip64Sizes(entry, extra);
    entry.name = decodeName(nameBytes, flags, extra).replaceAll('\\', '/');
    if (!entry.name.endsWith('/')) entries.push(entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** No page is this large: a bigger entry is broken, or built to exhaust memory when unpacked */
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

/**
 * An entry's contents. Stored (uncompressed) entries are a slice of the archive, read only when
 * used; compressed ones are unpacked, never past the size the archive declares, so a small entry
 * can't expand into gigabytes.
 */
export async function zipEntryBlob(file: Blob, entry: ZipEntry, type = ''): Promise<Blob> {
  checkEntry(entry);
  const start = await dataStart(file, entry);
  const data = file.slice(start, start + entry.compressedSize, type);
  if (entry.method === 0) return data;
  return new Blob([await inflate(data, entry.size)], { type });
}

/**
 * An entry's bytes. With `head`, only that many bytes from the start of a stored entry, which is
 * all an image header needs; compressed entries are always read whole.
 */
export async function readZipEntry(
  file: Blob,
  entry: ZipEntry,
  { head }: { head?: number } = {}
): Promise<Uint8Array> {
  checkEntry(entry);
  const start = await dataStart(file, entry);
  const length =
    head !== undefined && entry.method === 0
      ? Math.min(head, entry.compressedSize)
      : entry.compressedSize;
  const data = file.slice(start, start + length);
  if (entry.method === 0) return new Uint8Array(await data.arrayBuffer());
  return inflate(data, entry.size);
}

function checkEntry(entry: ZipEntry) {
  if (entry.encrypted) throw new UnsupportedZipError('This archive is password-protected');
  if (entry.method !== 0 && entry.method !== 8) {
    throw new UnsupportedZipError(`ZIP compression method ${entry.method} isn't supported`);
  }
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`${entry.name} is too large to open`);
  }
}

async function dataStart(file: Blob, entry: ZipEntry) {
  const header = await readAt(file, entry.localHeaderOffset, 30);
  if (header.getUint32(0, true) !== LOCAL_HEADER) throw new Error('Broken ZIP entry');
  return entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
}

/** Unpacks deflated data, stopping as soon as it grows past what the archive declared */
async function inflate(data: Blob, declaredSize: number) {
  const limit = Math.max(1, declaredSize);
  const reader = data.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const output = new Uint8Array(limit);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > limit) {
      await reader.cancel();
      throw new Error('Broken ZIP entry: it unpacks to more than its declared size');
    }
    output.set(value, length);
    length += value.byteLength;
  }
  return output.subarray(0, length);
}

/** Sizes and offsets past 4 GB are stored in a ZIP64 extra field, in this order */
function readZip64Sizes(entry: ZipEntry, extra: Uint8Array) {
  if (entry.size !== MAX && entry.compressedSize !== MAX && entry.localHeaderOffset !== MAX) return;
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let at = 0; at + 4 <= extra.length;) {
    const id = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (id === 0x0001) {
      let field = at + 4;
      const next = () => {
        const value = Number(view.getBigUint64(field, true));
        field += 8;
        return value;
      };
      if (entry.size === MAX) entry.size = next();
      if (entry.compressedSize === MAX) entry.compressedSize = next();
      if (entry.localHeaderOffset === MAX) entry.localHeaderOffset = next();
      return;
    }
    at += 4 + length;
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const shiftJis = new TextDecoder('shift_jis', { fatal: true });
const western = new TextDecoder('windows-1252');

/**
 * Names are UTF-8 when the archive says so. Archives made on Japanese Windows don't say, and use
 * Shift-JIS, so names that aren't valid UTF-8 are tried as Shift-JIS first.
 */
export function decodeName(bytes: Uint8Array, flags: number, extra: Uint8Array = new Uint8Array()) {
  if (flags & UTF8_NAMES) return new TextDecoder().decode(bytes);
  const unicodePath = findUnicodePath(extra);
  if (unicodePath) return unicodePath;
  for (const decoder of [utf8, shiftJis]) {
    try {
      return decoder.decode(bytes);
    } catch {
      // Not this encoding; try the next
    }
  }
  return western.decode(bytes);
}

/** Info-ZIP's extra field with a UTF-8 copy of the name */
function findUnicodePath(extra: Uint8Array) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let at = 0; at + 4 <= extra.length;) {
    const id = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (id === 0x7075 && length > 5 && extra[at + 4] === 1) {
      return new TextDecoder().decode(extra.subarray(at + 9, at + 4 + length));
    }
    at += 4 + length;
  }
  return undefined;
}

async function readAt(file: Blob, position: number, length: number) {
  const buffer = await file.slice(position, position + length).arrayBuffer();
  if (buffer.byteLength < length) throw new Error('Unexpected end of ZIP archive');
  return new DataView(buffer);
}
