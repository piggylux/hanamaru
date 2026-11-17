export type ImageSize = { width: number; height: number };

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/**
 * An image's size as it's displayed, read from its header without decoding it: the first few
 * kilobytes of a page are enough, which keeps measuring a 300-page archive fast. Undefined when
 * the header isn't one of these formats or is cut short; the caller then decodes the image.
 */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') {
    return valid(view.getUint32(16), view.getUint32(20));
  }
  if (ascii(bytes, 0, 3) === 'GIF') return valid(view.getUint16(6, true), view.getUint16(8, true));
  if (ascii(bytes, 0, 2) === 'BM' && bytes.length >= 26) {
    return valid(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webpSize(bytes, view);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, view);
  if (ascii(bytes, 4, 4) === 'ftyp') return isoSize(bytes, view);
  return undefined;
}

const valid = (width: number, height: number) =>
  width > 0 && height > 0 ? { width, height } : undefined;

function webpSize(bytes: Uint8Array, view: DataView) {
  if (bytes.length < 30) return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = bytes.subarray(21, 25);
    return valid(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | (b1 >> 6)));
  }
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return valid(width, height);
  }
  return undefined;
}

/** Start-of-frame markers, which hold the size: every SOFn except DHT, JPG and DAC */
const isFrameStart = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegSize(bytes: Uint8Array, view: DataView) {
  let orientation = 1;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1];
    // Padding, and markers without a length
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    const length = view.getUint16(at + 2);
    if (marker === 0xe1 && ascii(bytes, at + 4, 4) === 'Exif') {
      orientation = exifOrientation(view, at + 10, Math.min(bytes.length, at + 2 + length)) ?? 1;
    }
    if (isFrameStart(marker)) {
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      // Orientations 5 to 8 turn the photo a quarter turn, so it shows the other way round
      return orientation >= 5 ? valid(height, width) : valid(width, height);
    }
    at += 2 + length;
  }
  return undefined;
}

/** The orientation tag of an EXIF block: 1 is upright, 5 to 8 are turned a quarter */
function exifOrientation(view: DataView, start: number, end: number) {
  if (start + 8 > end) return undefined;
  const little = view.getUint16(start) === 0x4949;
  const directory = start + view.getUint32(start + 4, little);
  if (directory + 2 > end) return undefined;
  const count = view.getUint16(directory, little);
  for (let i = 0; i < count; i++) {
    const entry = directory + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return undefined;
}

/** AVIF and HEIF keep the size in an "ispe" box near the start */
function isoSize(bytes: Uint8Array, view: DataView) {
  for (let at = 4; at + 16 <= bytes.length; at++) {
    if (bytes[at] === 0x69 && ascii(bytes, at, 4) === 'ispe') {
      return valid(view.getUint32(at + 8), view.getUint32(at + 12));
    }
  }
  return undefined;
}
