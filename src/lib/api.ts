/**
 * Addresses of images. The service worker answers them with the engine's help, so they work like
 * any image address: in `<img src>`, lazily loaded.
 */
export const coverUrl = (id: number, version: string) => `/media/cover/${id}?v=${version}`;

export const pageUrl = (id: number, index: number, version: string) =>
  `/media/page/${id}/${index}?v=${version}`;

export const pageThumbUrl = (id: number, index: number, version: string) =>
  `/media/thumb/${id}/${index}?v=${version}`;

/** A search for one tag, quoted when it has spaces */
export function tagQuery(namespace: string, name: string) {
  return `${namespace}:${/[\s"]/.test(name) ? `"${name.replaceAll('"', '')}"` : name}`;
}

export function searchUrl(query: string) {
  return query ? `/?q=${encodeURIComponent(query)}` : '/';
}
