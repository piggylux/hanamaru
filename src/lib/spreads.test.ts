import { describe, expect, it } from 'bun:test';

import { buildSpreads, spreadOf, stepFor } from '#lib/spreads.js';

const portrait = { width: 700, height: 1000 };
const wide = { width: 1400, height: 1000 };
const unknown = { width: null, height: null };

describe('buildSpreads', () => {
  it('shows the cover alone, then pairs', () => {
    expect(buildSpreads(Array(6).fill(portrait))).toEqual([[0], [1, 2], [3, 4], [5]]);
  });

  it('keeps wide pages alone and realigns after them', () => {
    const pages = [portrait, portrait, portrait, wide, portrait, portrait];
    expect(buildSpreads(pages)).toEqual([[0], [1, 2], [3], [4, 5]]);
  });

  it('does not pair a page with a wide one', () => {
    const pages = [portrait, portrait, wide, portrait, portrait];
    expect(buildSpreads(pages)).toEqual([[0], [1], [2], [3, 4]]);
  });

  it('shifts by one page when asked', () => {
    expect(buildSpreads(Array(6).fill(portrait), true)).toEqual([[0], [1], [2, 3], [4, 5]]);
  });

  it('pairs pages whose size is not known yet', () => {
    expect(buildSpreads([unknown, unknown, unknown])).toEqual([[0], [1, 2]]);
  });

  it('handles tiny books', () => {
    expect(buildSpreads([])).toEqual([]);
    expect(buildSpreads([portrait])).toEqual([[0]]);
  });
});

describe('spreadOf', () => {
  it('finds the spread showing a page', () => {
    const spreads = [[0], [1, 2], [3, 4]];
    expect(spreadOf(spreads, 2)).toBe(1);
    expect(spreadOf(spreads, 3)).toBe(2);
    expect(spreadOf(spreads, 99)).toBe(0);
  });
});

describe('stepFor', () => {
  it('turns forward with the left side in right-to-left books', () => {
    expect(stepFor('left', 'rtl')).toBe(1);
    expect(stepFor('right', 'rtl')).toBe(-1);
    expect(stepFor('right', 'ltr')).toBe(1);
    expect(stepFor('left', 'ltr')).toBe(-1);
  });
});
