import { readyEngine } from '#lib/engine/client.js';
import { isSortKey } from '#lib/engine/search.js';

import type { PageLoad } from './$types';

/** The card size chosen with the slider, from 120 to 300 pixels */
function cardWidth() {
  const width = Number(/(?:^|; )card-width=(\d+)/.exec(document.cookie)?.[1]);
  return Number.isFinite(width) && width >= 120 && width <= 300 ? width : 180;
}

export const load: PageLoad = async ({ url, depends }) => {
  depends('app:library');
  const engine = await readyEngine();
  const query = url.searchParams.get('q')?.trim() ?? '';
  const sortParam = url.searchParams.get('sort');
  const sort = isSortKey(sortParam) ? sortParam : 'added';
  const seed = Number(url.searchParams.get('seed')) || 0;
  return {
    query,
    sort,
    seed,
    ...(await engine.library({ query, sort, seed })),
    cardWidth: cardWidth(),
  };
};
