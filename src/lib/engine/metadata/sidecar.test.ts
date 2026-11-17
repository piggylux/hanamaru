import { describe, expect, it } from 'bun:test';

import { combineSidecars, parseSidecar } from './sidecar.js';

const tagNames = (tags: { namespace: string; name: string }[]) =>
  tags.map((tag) => `${tag.namespace}:${tag.name}`).sort();

describe('parseSidecar', () => {
  it('reads ComicInfo.xml', () => {
    const xml = `<?xml version="1.0"?>
      <ComicInfo>
        <Title>Summer &amp; Sea</Title>
        <Writer>Artist A, Artist B</Writer>
        <Tags>female:swimsuit, full color</Tags>
        <LanguageISO>en</LanguageISO>
        <Web>https://e-hentai.org/g/123456/abcdef0123/</Web>
      </ComicInfo>`;
    const result = parseSidecar('ComicInfo.xml', xml)!;
    expect(result.title).toBe('Summer & Sea');
    expect(result.ehGid).toBe(123456);
    expect(result.ehToken).toBe('abcdef0123');
    expect(tagNames(result.tags)).toEqual(
      [
        'artist:artist a',
        'artist:artist b',
        'female:swimsuit',
        'language:english',
        'language:translated',
        'other:full color',
      ].sort()
    );
  });

  it('reads gallery-dl info.json', () => {
    const json = JSON.stringify({
      category: 'exhentai',
      gid: 2345678,
      token: '0123456789',
      title: 'Title &#039;quoted&#039;',
      title_jpn: 'タイトル',
      eh_category: 'Doujinshi',
      lang: 'en',
      tags: ['artist:someone', 'parody:blue archive', 'female:glasses'],
    });
    const result = parseSidecar('info.json', json)!;
    expect(result.title).toBe("Title 'quoted'");
    expect(result.titleJpn).toBe('タイトル');
    expect(result.category).toBe('Doujinshi');
    expect(result.ehGid).toBe(2345678);
    expect(tagNames(result.tags)).toContain('parody:blue archive');
    expect(tagNames(result.tags)).toContain('language:english');
  });

  it('reads gallery-dl tags grouped by namespace', () => {
    const result = parseSidecar(
      'info.json',
      JSON.stringify({ title: 'T', tags_artist: ['a'], tags: { female: ['b'] } })
    )!;
    expect(tagNames(result.tags)).toEqual(['artist:a', 'female:b']);
  });

  it('reads Hentai@Home galleryinfo.txt', () => {
    const text = [
      'Title:       [Artist] Title [English]',
      'Upload Time: 2020-01-01 00:00',
      'Uploaded By: someone',
      'Tags:        language:english, language:translated, artist:artist, female:big breasts',
      '',
      "Uploader's Comments:",
      'thanks',
    ].join('\r\n');
    const result = parseSidecar('galleryinfo.txt', text)!;
    expect(result.title).toBe('[Artist] Title [English]');
    expect(tagNames(result.tags)).toContain('female:big breasts');
  });

  it('reads E-Hentai downloader info.txt', () => {
    const text = [
      '[Artist] Title',
      '[作家] タイトル',
      'https://exhentai.org/g/3456789/fedcba9876/',
      '',
      'Category: Doujinshi',
      'Language: English',
      '',
      'Tags:',
      '> parody: blue archive',
      '> female: glasses, stockings',
    ].join('\n');
    const result = parseSidecar('info.txt', text)!;
    expect(result.title).toBe('[Artist] Title');
    expect(result.titleJpn).toBe('[作家] タイトル');
    expect(result.ehGid).toBe(3456789);
    expect(result.category).toBe('Doujinshi');
    expect(tagNames(result.tags)).toEqual(
      [
        'female:glasses',
        'female:stockings',
        'language:english',
        'language:translated',
        'parody:blue archive',
      ].sort()
    );
  });

  it('ignores files it cannot read', () => {
    expect(parseSidecar('info.json', '{not json')).toBeUndefined();
  });
});

describe('combineSidecars', () => {
  it('keeps the first title and every tag', () => {
    const combined = combineSidecars([
      { title: 'First', tags: [{ namespace: 'artist', name: 'a' }] },
      {
        title: 'Second',
        ehGid: 1,
        ehToken: '0123456789',
        tags: [{ namespace: 'female', name: 'b' }],
      },
    ])!;
    expect(combined.title).toBe('First');
    expect(combined.ehGid).toBe(1);
    expect(combined.tags).toHaveLength(2);
  });
});
