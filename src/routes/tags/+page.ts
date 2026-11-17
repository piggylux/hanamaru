import { readyEngine } from '#lib/engine/client.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ depends }) => {
  depends('app:library');
  const engine = await readyEngine();
  return { tags: await engine.tags({ limit: 5000 }) };
};
