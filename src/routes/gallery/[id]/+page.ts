import { idParam, orNotFound, readyEngine } from '#lib/engine/client.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, depends }) => {
  depends('app:gallery');
  const engine = await readyEngine();
  return orNotFound(engine.gallery(idParam(params.id)));
};
