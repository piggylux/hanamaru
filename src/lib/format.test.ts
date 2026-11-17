import { describe, expect, it } from 'bun:test';

import { count, displayName, languageCode } from '#lib/format.js';

describe('displayName', () => {
  it('capitalizes each word of a lower-case tag', () => {
    expect(displayName('artist a')).toBe('Artist A');
    expect(displayName('love live! sunshine!!')).toBe('Love Live! Sunshine!!');
    expect(displayName('re:zero kara hajimeru')).toBe('Re:zero Kara Hajimeru');
  });

  it('leaves names without lower-case letters alone', () => {
    expect(displayName('作家')).toBe('作家');
    expect(displayName('ABC')).toBe('ABC');
  });
});

describe('count', () => {
  it('pluralizes', () => {
    expect(count(1, 'page')).toBe('1 page');
    expect(count(12, 'page')).toBe('12 pages');
    expect(count(1200, 'doujin')).toBe(`${(1200).toLocaleString()} doujins`);
  });
});

describe('languageCode', () => {
  it('shortens known languages and falls back to two letters', () => {
    expect(languageCode('english')).toBe('EN');
    expect(languageCode('klingon')).toBe('KL');
  });
});
