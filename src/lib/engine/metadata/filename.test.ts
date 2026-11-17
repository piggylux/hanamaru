import { describe, expect, it } from 'bun:test';

import { parseFilename } from './filename.js';

const tagsOf = (name: string) =>
  parseFilename(name)
    .tags.map((tag) => `${tag.namespace}:${tag.name}`)
    .sort();

describe('parseFilename', () => {
  it('reads the full convention', () => {
    const name = '(C99) [Circle Name (Artist Name)] Some Title (Blue Archive) [English] [Digital]';
    expect(parseFilename(name).title).toBe('Some Title');
    expect(tagsOf(name)).toEqual(
      [
        'artist:artist name',
        'event:c99',
        'group:circle name',
        'language:english',
        'language:translated',
        'other:digital',
        'parody:blue archive',
      ].sort()
    );
  });

  it('reads a bare artist and a Japanese title', () => {
    const result = parseFilename('[ほげ] 夏の思い出');
    expect(result.title).toBe('夏の思い出');
    expect(tagsOf('[ほげ] 夏の思い出')).toEqual(['artist:ほげ']);
  });

  it('splits several artists, parodies and circles', () => {
    const name =
      '[Circle A, Circle B (Artist A, Artist B)] Crossover (Touhou Project, Kantai Collection)';
    expect(tagsOf(name)).toEqual(
      [
        'artist:artist a',
        'artist:artist b',
        'group:circle a',
        'group:circle b',
        'parody:kantai collection',
        'parody:touhou project',
      ].sort()
    );
  });

  it('skips the "original" parody', () => {
    expect(tagsOf('[Artist] Title (Original)')).toEqual(['artist:artist']);
    expect(parseFilename('[Artist] Title (Original)').title).toBe('Title');
  });

  it('keeps part numbers in the title', () => {
    expect(parseFilename('[Artist] Long Story (Part 2) [English]').title).toBe(
      'Long Story (Part 2)'
    );
    expect(parseFilename('[Artist] Long Story (2)').title).toBe('Long Story (2)');
  });

  it('ignores translator groups', () => {
    const name = '[Artist] Title (Genshin Impact) [English] [Some Scans] {Another Group}';
    expect(parseFilename(name).title).toBe('Title');
    expect(tagsOf(name)).toContain('parody:genshin impact');
    expect(tagsOf(name)).not.toContain('other:some scans');
  });

  it('reads Chinese translation notes and fullwidth brackets', () => {
    const name = '（C97）【サークル（作家）】タイトル（オリジナル）【中国翻訳】';
    const result = parseFilename(name);
    expect(result.title).toBe('タイトル');
    expect(tagsOf(name)).toEqual(
      [
        'event:c97',
        'group:サークル',
        'artist:作家',
        'language:chinese',
        'language:translated',
      ].sort()
    );
  });

  it('reads the gallery number Hentai@Home puts at the end', () => {
    const result = parseFilename('[Artist] Title [English] [1234567]');
    expect(result.ehGidHint).toBe(1234567);
    expect(result.title).toBe('Title');
  });

  it('does not treat book kinds as events', () => {
    expect(tagsOf('(成年コミック) [作家] 単行本タイトル')).toEqual(['artist:作家']);
  });

  it('marks anthologies', () => {
    expect(tagsOf('[Anthology] Collected Stories')).toEqual(['other:anthology']);
  });

  it('marks Japanese books without adding translated', () => {
    expect(tagsOf('[Artist] Title [Japanese]')).toEqual(['artist:artist', 'language:japanese']);
  });

  it('marks decensored and uncensored editions the same way', () => {
    expect(tagsOf('[Artist] Title [Decensored]')).toContain('other:uncensored');
    expect(tagsOf('[Artist] Title [無修正]')).toContain('other:uncensored');
  });

  it('keeps names without any convention as they are', () => {
    expect(parseFilename('my_scans 03').title).toBe('my scans 03');
    expect(parseFilename('my_scans 03').tags).toEqual([]);
  });

  it('falls back to the whole name when only brackets remain', () => {
    expect(parseFilename('[English]').title).toBe('[English]');
  });

  it('handles several events', () => {
    expect(tagsOf('(C99) (Reitaisai 18) [Artist] Title')).toEqual(
      ['artist:artist', 'event:c99', 'event:reitaisai 18'].sort()
    );
  });
});
