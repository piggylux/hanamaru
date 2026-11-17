import { foldersNeedingAccess, readyEngine } from '#lib/engine/client.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ depends }) => {
  depends('app:settings');
  depends('app:library');
  const engine = await readyEngine();
  const estimate = await navigator.storage.estimate();
  return {
    ...(await engine.settings()),
    needingAccess: await foldersNeedingAccess(),
    storage: { usage: estimate.usage, persisted: await navigator.storage.persisted() },
  };
};
