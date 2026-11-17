import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) => (filename.includes('node_modules') ? undefined : true),
      },

      // Static files only: everything runs in the browser, so any static host serves it.
      // Every address falls back to index.html, where the app picks the page to show.
      adapter: adapter({ fallback: 'index.html' }),

      // Only this app's own scripts run, and every image comes from the site itself. Static
      // hosting has no server to send this, so it goes in the page, with the hash of the one
      // inline script SvelteKit starts the app with.
      csp: {
        mode: 'hash',
        directives: {
          'default-src': ['self'],
          // SQLite is WebAssembly, compiled by the engine's worker
          'script-src': ['self', 'wasm-unsafe-eval'],
          'worker-src': ['self'],
          // Svelte writes inline styles for card sizes, progress bars and the reader layout
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'blob:'],
          'connect-src': ['self'],
          'manifest-src': ['self'],
          'form-action': ['self'],
          'base-uri': ['self'],
          'object-src': ['none'],
        },
      },
    }),
  ],
  // Icons ship as .svelte files, which Vite compiles
  ssr: { noExternal: ['@lucide/svelte'] },
  // SQLite loads its WebAssembly file from beside its own script, which pre-bundling would move
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  // The engine's worker imports modules, like the rest of the app
  worker: { format: 'es' },
  server: {
    // The dev server stays on this computer
    host: '127.0.0.1',
  },
});
