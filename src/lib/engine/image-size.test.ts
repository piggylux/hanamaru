import { describe, expect, it } from 'bun:test';

import { imageSize } from './image-size.js';
import { testImage } from './test-helpers.js';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part
    )
  );

const u16be = (value: number) => [value >> 8, value & 0xff];
const u32be = (value: number) => [
  value >>> 24,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];
const u16le = (value: number) => [value & 0xff, value >> 8];
const u24le = (value: number) => [value & 0xff, (value >> 8) & 0xff, value >> 16];

/** A JPEG with an EXIF block giving `orientation`, then a frame header of the given size */
function jpeg(width: number, height: number, orientation?: number) {
  const exif = orientation
    ? [
        0xff,
        0xe1,
        ...u16be(2 + 6 + 8 + 2 + 12),
        ...bytes('Exif', [0, 0]),
        // TIFF header, big-endian, first directory right after it
        ...bytes('MM', [0, 42], u32be(8)),
        ...u16be(1),
        // Orientation tag: type SHORT, one value
        ...u16be(0x0112),
        ...u16be(3),
        ...u32be(1),
        ...u16be(orientation),
        0,
        0,
      ]
    : [];
  return bytes(
    [0xff, 0xd8],
    exif,
    [0xff, 0xc0, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3],
    Array.from({ length: 24 }, () => 0)
  );
}

describe('imageSize', () => {
  it('reads PNG, GIF and BMP headers', () => {
    expect(imageSize(testImage(120, 90))).toEqual({ width: 120, height: 90 });
    expect(
      imageSize(
        bytes(
          'GIF89a',
          u16le(30),
          u16le(40),
          Array.from({ length: 20 }, () => 0)
        )
      )
    ).toEqual({
      width: 30,
      height: 40,
    });
  });

  it('reads JPEG frame headers, turned by their EXIF orientation', () => {
    expect(imageSize(jpeg(800, 1200))).toEqual({ width: 800, height: 1200 });
    expect(imageSize(jpeg(800, 1200, 1))).toEqual({ width: 800, height: 1200 });
    // Orientation 6: the camera was held sideways, so the photo shows taller than it's stored
    expect(imageSize(jpeg(1200, 800, 6))).toEqual({ width: 800, height: 1200 });
  });

  it('reads the three kinds of WebP', () => {
    const riff = (chunk: string, body: number[]) =>
      bytes(
        'RIFF',
        [0, 0, 0, 0],
        'WEBP',
        chunk,
        [0, 0, 0, 0],
        body,
        Array.from({ length: 16 }, () => 0)
      );
    // Lossy: a frame tag, the start code, then 14-bit sizes
    expect(
      imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(640), ...u16le(480)]))
    ).toEqual({ width: 640, height: 480 });
    // Lossless: width - 1 and height - 1 packed into 14 bits each after a signature byte
    const w = 639;
    const h = 479;
    const packed = [
      0x2f,
      w & 0xff,
      ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
      (h >> 2) & 0xff,
      h >> 10,
    ];
    expect(imageSize(riff('VP8L', packed))).toEqual({ width: 640, height: 480 });
    // Extended: 24-bit canvas sizes minus one
    expect(imageSize(riff('VP8X', [0, 0, 0, 0, ...u24le(639), ...u24le(479)]))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('reads the size box of AVIF images', () => {
    const avif = bytes(
      [0, 0, 0, 20],
      'ftypavif',
      Array.from({ length: 8 }, () => 0),
      [0, 0, 0, 20],
      'ispe',
      [0, 0, 0, 0],
      u32be(1000),
      u32be(1400)
    );
    expect(imageSize(avif)).toEqual({ width: 1000, height: 1400 });
  });

  it('gives up on anything else, or a header cut short', () => {
    expect(imageSize(bytes('not an image at all, just text'))).toBeUndefined();
    expect(imageSize(jpeg(800, 1200).subarray(0, 8))).toBeUndefined();
  });
});
