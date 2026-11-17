# Contributor instructions

These instructions apply throughout this repository. Keep contributor rules and design conventions
here; keep `README.md` focused on the product and getting started.

In the README's Features list, describe each feature by what people can do with it, in a sentence
or two. Leave out how it works; put that in code comments, commit messages, or the README's
technical sections.

## Engineering approach

- Challenge architecture choices when there is a concrete concern. Explain the tradeoff and
  recommend the simplest sound solution instead of agreeing automatically.
- Avoid over-engineering. Reuse existing components and patterns before introducing abstractions,
  dependencies, or frameworks.
- Preserve unrelated work in the working tree.

## Product rules

- hanamaru never writes to the library. Library folders are opened with `mode: 'read'` only, and
  everything hanamaru learns lives in the site's own storage (the database and thumbnails in
  OPFS, folder handles in IndexedDB). Never ask for write access to a library folder.
- Nothing about the library leaves the browser: no uploads, analytics or requests to other sites.
- hanamaru supports Chrome and Edge on a computer. Other browsers get the "unsupported" screen,
  not a degraded app.

## Stack and structure

- Svelte 5, SvelteKit 3, TypeScript, Bun (tooling and tests), Tailwind CSS and daisyUI. The app is
  a static single-page app (`@sveltejs/adapter-static`, `ssr = false`) hosted on Vercel.
- Use `#lib/*` imports. Tailwind and daisyUI classes use the `tw:` prefix; component styles stay
  unprefixed beside their markup.
- The engine lives in `src/lib/engine` and runs in a dedicated worker (`worker.ts`): SQLite
  compiled to WebAssembly (`sqlite.ts`), scanning, the ZIP reader and thumbnails. Pages call it
  through `engine` from `client.ts`; every function it offers is in `api.ts` and takes the
  engine first. Keep engine modules free of `$app/*` and DOM-only APIs so `bun test` can load
  them; browser-only pieces (`codec.ts`, `opfs.ts`, `roots-idb.ts`) sit behind the interfaces in
  `context.ts` and `files.ts`.
- Images are `/media/...` addresses (`#lib/api.js`), answered by `src/service-worker.ts` through
  the page and the engine. Use them in `<img src>` like any image.
- Database changes are new entries at the end of `MIGRATIONS` in `src/lib/engine/db.ts`. Never
  edit a migration that has shipped.
- Shared colors, radii and dialog spacing live in `src/app.css`; global typography and focus
  styles in `src/routes/styles.css`. Element styles there stay in `@layer base` so daisyUI's
  components can override them.
- Use `Dialog.svelte` for dialogs and `CloseButton.svelte` for dismiss controls.

## Visual direction

- Keep surfaces neutral gray and let covers carry the color. Primary buttons use the text color
  (`--ink`); Hanamaru's amber (`--accent`) is only for small marks: progress, ratings, focus and
  the current item. Pair status colors with text or an icon; never rely on color alone.
- Prefer clear hierarchy, consistent spacing and hairline borders over cards, gradients,
  decorations or stacked shadows. Tags are square-cornered `.chip`s, not pills; choices among a
  few options are `.segmented` radio groups.
- Write copy like a tool, not a tour guide: short labels in sentence case, one line of help at
  most, no narration of what hanamaru does ("hanamaru looks through…"). Names from tags are shown
  with `displayName()` outside tag lists.
- Icons come from Lucide through `Icon.svelte`; add new ones there under an app-level name.
- The reader is always dark and stays out of the way: controls fade while reading.
- Check visual changes in both light and dark themes, at phone and desktop widths.

## Accessibility and verification

- Use semantic links, buttons, labels and headings. Give icon-only controls accessible names.
- Touch targets are at least 44px. Preserve the skip link, visible keyboard focus and
  reduced-motion behavior.
- For code changes, run `bun run lint`, `bun run check`, `bun run test` and `bun run build`.
  Format changed files with `bunx oxfmt <paths>`.
- Add tests for meaningful behavior changes. Engine tests use in-memory folders, storage and
  database (`#lib/engine/test-helpers.js`); never point them at a real library.
