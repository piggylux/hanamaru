import { idParam, orNotFound, readyEngine } from '#lib/engine/client.js';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => {
  const engine = await readyEngine();
  const id = idParam(params.id);
  const { gallery, prefs } = await orNotFound(engine.reader(id));
  const requested = Number(url.searchParams.get('page'));
  const startPage =
    Number.isInteger(requested) && url.searchParams.has('page')
      ? Math.min(Math.max(0, requested), gallery.pageCount - 1)
      : gallery.readCount > 0 && gallery.lastPage >= gallery.pageCount - 1
        ? 0
        : gallery.lastPage;
  return {
    gallery: {
      id: gallery.id,
      title: gallery.title,
      pageCount: gallery.pageCount,
      version: gallery.version,
    },
    startPage,
    prefs,
    // Page sizes arrive after the first page shows: measuring them can take a moment the first time
    pages: engine.pageSizes(id),
  };
};
