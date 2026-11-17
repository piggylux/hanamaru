import { describe, expect, it } from 'bun:test';

import { zipSync } from 'fflate';

import { decodeName, readZipDirectory, readZipEntry, zipEntryBlob } from './zip.js';

/** An archive as the browser hands it out: a Blob */
const blob = (bytes: Uint8Array | string) =>
  new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)]);

const text = (value: string) => new TextEncoder().encode(value);

describe('readZipDirectory', () => {
  it('lists entries and reads stored and compressed ones', async () => {
    const bytes = zipSync({
      '001.jpg': [text('first page'), { level: 0 }],
      'chapter 2/010.png': [text('compressed page '.repeat(50)), { level: 9 }],
      'empty/': new Uint8Array(),
    });
    const path = blob(bytes);

    const entries = await readZipDirectory(path);
    expect(entries.map((entry) => entry.name)).toEqual(['001.jpg', 'chapter 2/010.png']);
    expect(entries[0].method).toBe(0);
    expect(entries[1].method).toBe(8);

    expect(new TextDecoder().decode(await readZipEntry(path, entries[0]))).toBe('first page');
    expect(new TextDecoder().decode(await readZipEntry(path, entries[1]))).toBe(
      'compressed page '.repeat(50)
    );
    // As a Blob for the reader: a slice of the archive when stored, unpacked when compressed
    expect(await (await zipEntryBlob(path, entries[0], 'image/jpeg')).text()).toBe('first page');
    expect(await (await zipEntryBlob(path, entries[1])).text()).toBe('compressed page '.repeat(50));
    expect((await zipEntryBlob(path, entries[0], 'image/jpeg')).type).toBe('image/jpeg');
  });

  it('reads archives with a comment after the directory', async () => {
    // The end record is the last 22 bytes; its last field is the comment's length
    const zip = zipSync({ 'a.jpg': text('a') });
    const withComment = new Uint8Array(zip.length + 1000).fill(0x78);
    withComment.set(zip);
    new DataView(withComment.buffer).setUint16(zip.length - 2, 1000, true);
    expect((await readZipDirectory(blob(withComment))).map((entry) => entry.name)).toEqual([
      'a.jpg',
    ]);
  });

  it('rejects files that are not ZIP archives', async () => {
    await expect(readZipDirectory(blob('hello'))).rejects.toThrow('Not a ZIP archive');
  });
});

describe('readZipEntry', () => {
  it('reads only the start of a stored entry when asked', async () => {
    const path = blob(zipSync({ 'big.jpg': [text('x'.repeat(5000)), { level: 0 }] }));
    const [entry] = await readZipDirectory(path);
    expect((await readZipEntry(path, entry, { head: 100 })).length).toBe(100);
    expect((await readZipEntry(path, entry)).length).toBe(5000);
  });

  it('refuses to unpack more than the archive declares', async () => {
    const bytes = zipSync({ 'bomb.jpg': [new Uint8Array(200_000), { level: 9 }] });
    // Claim the entry unpacks to 10 bytes, as a decompression bomb would
    const view = new DataView(bytes.buffer);
    for (let at = bytes.length - 22; at >= 0; at--) {
      if (view.getUint32(at, true) === 0x02014b50) {
        view.setUint32(at + 24, 10, true);
        break;
      }
    }
    const path = blob(bytes);
    const [entry] = await readZipDirectory(path);
    expect(entry.size).toBe(10);
    await expect(readZipEntry(path, entry)).rejects.toThrow();
    await expect(zipEntryBlob(path, entry)).rejects.toThrow();
  });
});

describe('decodeName', () => {
  it('reads UTF-8 names marked as such', () => {
    expect(decodeName(text('ページ01.jpg'), 0x800)).toBe('ページ01.jpg');
  });

  it('reads unmarked UTF-8 names', () => {
    expect(decodeName(text('ページ01.jpg'), 0)).toBe('ページ01.jpg');
  });

  it('reads Shift-JIS names from Japanese Windows', () => {
    // "表紙.jpg" (cover) in Shift-JIS
    const shiftJis = new Uint8Array([0x95, 0x5c, 0x8e, 0x86, 0x2e, 0x6a, 0x70, 0x67]);
    expect(decodeName(shiftJis, 0)).toBe('表紙.jpg');
  });
});
