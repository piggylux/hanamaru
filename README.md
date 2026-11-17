# hanamaru

A library and reader for the doujins on your computer, in the browser. It reads them straight from
a folder you choose, and keeps everything it learns in the browser itself: nothing is uploaded.

It works in Chrome and Edge on a computer, the browsers that let a site read a folder you pick.

## Features

- **Your folders, as they are.** Pick the folder where your doujins live. hanamaru finds every
  image folder, ZIP and CBZ inside it, and never moves, renames or changes a file.
- **Covers at a glance.** Browse thousands of doujins as a grid of covers, sorted by date added,
  last read, title, rating or page count, or shuffled.
- **Tags from the file names.** Names like `(C99) [Circle (Artist)] Title (Parody) [English]` become
  the artist, circle, parody, event and language tags you'd expect.
- **Details saved by download tools.** ComicInfo.xml, gallery-dl's info.json and Hentai@Home's
  galleryinfo.txt fill in titles and tags where they exist.
- **Search like E-Hentai.** Type words, or tags such as `artist:name`, `parody:"blue archive"`,
  `-female:glasses`, `is:unread`, `rating>=4` or `pages<30`, with suggestions as you type.
- **Organize your way.** Mark favorites, rate doujins, group them into collections, and edit titles
  and tags by hand.
- **A comfortable reader.** Read one page at a time, as two-page spreads the way the book was
  printed, or as one long scroll. Right-to-left by default, with keyboard, click, tap and swipe
  controls, and each doujin remembers your page and layout.
- **Back to where you were.** Leaving a doujin returns you to the search or list you opened it
  from, scrolled to the same place.
- **Back up and restore.** Export everything hanamaru knows about your library to one file, and
  import it in another browser or on another computer. Doujins get their tags, favorites and
  progress back even if they now live in a different folder.
- **Moved files keep their history.** Rename or reorganize your folders in Explorer: tags,
  favorites and progress follow each doujin to its new place.

RAR, CBR, 7z and CB7 archives are counted when the library is scanned, but browsers have no way to
open them; repack them as ZIP or CBZ to read them.

## Using it

Open the site in Chrome or Edge, go to **Settings**, and choose **Add folder…**. The browser asks
whether hanamaru may view the folder's files; it can only read them. hanamaru then scans the folder
and shows the covers as it goes.

On later visits the browser may ask again before hanamaru can read the folder. Choose **Allow on
every visit** so it doesn't. Covers show even before access is allowed; opening a doujin needs it.

To use it like a desktop app, install it as an app from the browser's menu: it gets its own window
and a place in the Start menu.

### Keyboard shortcuts in the reader

| Key                          | Action                                                   |
| ---------------------------- | -------------------------------------------------------- |
| Click the left or right half | Turn the page that way                                   |
| ← → or A D                   | Turn the page (left goes forward in right-to-left books) |
| Space, Page Down             | Next page                                                |
| Shift + Space, Page Up       | Previous page                                            |
| Home, End                    | First or last page                                       |
| F                            | Full screen                                              |
| Esc                          | Back to the doujin                                       |

## Where things are kept

Everything hanamaru knows (titles, tags, progress, collections and the cover thumbnails) is stored
in the browser, in the site's private storage. It stays on this computer, in this browser.

Clearing the site's data in the browser deletes it, so export a backup from **Settings → Backup**
first. The doujins themselves are never touched either way.

hanamaru can be open in one tab at a time; a second tab says so.

## Moving from the server version

The earlier version of hanamaru ran as a server on your computer. To bring its library over,
export a backup from its **Settings → Backup**, then import it here once your folder is added.
Doujins are recognised by their pages, so their details come back even though paths differ. RAR
and 7z doujins in the backup wait until they're repacked as ZIP.

## Hosting it

hanamaru is a static site: the build is plain files that any static host can serve.

On [Vercel](https://vercel.com), import the repository; `vercel.json` sets the build. Elsewhere:

```sh
bun install
bun run build    # the site is in build/
```

Serve `build/` with every unknown address answered by `build/index.html`. The site must be served
over HTTPS (or from `localhost`): browsers only allow folder access and service workers there.

## Privacy and security

- The library never leaves your computer: the site only reads files in the browser, and never
  sends them, or anything about them, anywhere.
- Folder access is read-only. hanamaru can't rename, move, change or delete a file.
- The site loads nothing from other sites, and its pages can't be embedded by other sites.
- Archives are read defensively: entries can't point outside their folder, and oversized or
  "zip bomb" entries are refused.

## Development

```sh
bun run dev      # dev server with hot reload, on this computer only
bun run test     # unit and integration tests (bun test)
bun run check    # type check
bun run lint     # formatting and lint
bun run build    # the static site, in build/
```

The app is SvelteKit, built as a single-page app. Its engine runs in a web worker: SQLite compiled
to WebAssembly, stored in the site's private storage (OPFS), a small ZIP reader of its own, and the
browser's own image decoding for thumbnails. A service worker answers the app's image addresses
from the engine. See `AGENTS.md` for conventions.
