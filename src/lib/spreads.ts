import type { PageInfo } from '#lib/types.js';

/** A page this much wider than tall is a spread drawn across two pages, shown on its own */
const WIDE = 1.1;

export function isWide(page: PageInfo | undefined) {
  return !!page?.width && !!page.height && page.width > page.height * WIDE;
}

/**
 * Pairs pages the way the printed book opens: the cover alone, then two pages side by side.
 * A wide page stays alone, which also realigns the pairs after it. `shift` puts the page after
 * the cover on its own, for books whose spreads come out one page off.
 */
export function buildSpreads(pages: PageInfo[], shift = false): number[][] {
  const spreads: number[][] = [];
  if (!pages.length) return spreads;
  spreads.push([0]);
  let index = 1;
  if (shift && index < pages.length) spreads.push([index++]);
  while (index < pages.length) {
    const pairable = index + 1 < pages.length && !isWide(pages[index]) && !isWide(pages[index + 1]);
    if (pairable) {
      spreads.push([index, index + 1]);
      index += 2;
    } else {
      spreads.push([index]);
      index += 1;
    }
  }
  return spreads;
}

/** The spread showing a page */
export function spreadOf(spreads: number[][], page: number) {
  const found = spreads.findIndex((spread) => spread.includes(page));
  return found < 0 ? 0 : found;
}

/**
 * Which way a key or tap moves through the book. Right-to-left books turn forward with the left
 * arrow, as their pages turn toward the left.
 */
export function stepFor(side: 'left' | 'right', direction: 'rtl' | 'ltr') {
  const forward = direction === 'rtl' ? side === 'left' : side === 'right';
  return forward ? 1 : -1;
}
