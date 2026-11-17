import { describe, expect, it } from 'bun:test';

import { isPage, naturalCompare } from './images.js';

describe('isPage', () => {
  it('accepts images, including in subfolders', () => {
    expect(isPage('001.jpg')).toBe(true);
    expect(isPage('chapter 2/010.PNG')).toBe(true);
  });

  it('skips other files, hidden files and macOS leftovers', () => {
    expect(isPage('info.txt')).toBe(false);
    expect(isPage('cover.svg')).toBe(false);
    expect(isPage('.hidden.jpg')).toBe(false);
    expect(isPage('__MACOSX/._001.jpg')).toBe(false);
  });

  it('refuses names that would point outside the archive', () => {
    expect(isPage('../../escape.jpg')).toBe(false);
    expect(isPage('pages\\..\\..\\escape.jpg')).toBe(false);
    expect(isPage('/absolute/escape.jpg')).toBe(false);
    expect(isPage('C:\\Windows\\escape.jpg')).toBe(false);
    expect(isPage('C:escape.jpg')).toBe(false);
  });
});

describe('naturalCompare', () => {
  it('orders numbered pages the way people count', () => {
    expect(['10.jpg', '2.jpg', '1.jpg'].sort(naturalCompare)).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });
});
