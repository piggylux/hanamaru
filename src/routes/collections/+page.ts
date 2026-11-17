import { readyEngine } from '#lib/engine/client.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ depends }) => {
  depends('app:collections');
  const engine = await readyEngine();
  return { collections: await engine.collections() };
};
