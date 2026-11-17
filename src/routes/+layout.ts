import { foldersNeedingAccess, startEngine } from '#lib/engine/client.js';

import type { LayoutLoad } from './$types';

// Everything runs in the browser: there is no server to render pages
export const ssr = false;
export const prerender = false;

export type Theme = 'system' | 'light' | 'dark';

/** The theme picked in the header, kept in a cookie */
function savedTheme(): Theme {
  const value = /(?:^|; )theme=(light|dark)(?:;|$)/.exec(document.cookie)?.[1];
  return value === 'light' || value === 'dark' ? value : 'system';
}

export const load: LayoutLoad = async () => {
  const theme = savedTheme();
  if (theme !== 'system') document.documentElement.dataset.theme = theme;
  const engine = await startEngine();
  return {
    theme,
    engine,
    // Folders the browser needs to be allowed to read again, after a restart for instance
    needsAccess: engine.status === 'ready' && (await foldersNeedingAccess()).length > 0,
  };
};
