<script lang="ts">
  import { afterNavigate, beforeNavigate, goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';

  import GalleryCard from '#lib/components/GalleryCard.svelte';
  import GalleryGrid from '#lib/components/GalleryGrid.svelte';
  import Icon, { type IconName } from '#lib/components/Icon.svelte';
  import { live } from '#lib/live.svelte.js';
  import { libraryReturn } from '#lib/return.svelte.js';
  import type { SortKey } from '#lib/types.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const SORTS: { value: SortKey; label: string }[] = [
    { value: 'added', label: 'Recently added' },
    { value: 'read', label: 'Recently read' },
    { value: 'title', label: 'Title' },
    { value: 'rating', label: 'Rating' },
    { value: 'pages', label: 'Most pages' },
    { value: 'random', label: 'Shuffle' },
  ];

  const filters: { query: string; label: string; icon: IconName }[] = [
    { query: '', label: 'All', icon: 'library' },
    { query: 'is:reading', label: 'Continue reading', icon: 'book' },
    { query: 'is:unread', label: 'Unread', icon: 'unread' },
    { query: 'is:favorite', label: 'Favorites', icon: 'heart' },
  ];

  /** What the list shows, in words: a filter's name, a collection's, or the search */
  const heading = $derived.by(() => {
    if (!data.query) return 'All doujins';
    const filter = filters.find((item) => item.query === data.query);
    if (filter) return filter.label;
    if (data.query === 'is:missing') return 'Missing';
    const collection = /^in:"(.+)"$/.exec(data.query)?.[1];
    if (collection) return collection;
    return `Results for “${data.query}”`;
  });

  // Kept in a cookie rather than local storage, so the server draws the cards at this size and
  // reloading doesn't show them at the default size first
  // svelte-ignore state_referenced_locally
  let cardWidth = $state(data.cardWidth);

  function saveCardWidth() {
    document.cookie = `card-width=${cardWidth}; path=/; max-age=31536000; samesite=lax`;
  }

  // Reloads the list when a scan or match changed the library
  let seenVersion = live.libraryVersion;
  $effect(() => {
    if (live.libraryVersion !== seenVersion) {
      seenVersion = live.libraryVersion;
      invalidate('app:library');
    }
  });

  function withParams(changes: Record<string, string | null>) {
    const params = new URLSearchParams(page.url.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    const search = params.toString();
    return search ? `/?${search}` : '/';
  }

  function setSort(sort: string) {
    goto(
      withParams({
        sort: sort === 'added' ? null : sort,
        seed: sort === 'random' ? String(Math.floor(Math.random() * 1e9)) : null,
      }),
      { reset: false }
    );
  }

  const gridParams = $derived(
    new URLSearchParams({ q: data.query, sort: data.sort, seed: String(data.seed) }).toString()
  );
  const isFilter = (query: string) => data.query === query;

  // Opening a doujin remembers this list, so its page can come straight back to it
  beforeNavigate(({ to }) => {
    if (to?.route.id === '/gallery/[id]' || to?.route.id === '/read/[id]') {
      libraryReturn.remember({
        url: page.url.pathname + page.url.search,
        heading,
        scrollY: window.scrollY,
      });
    }
  });

  /**
   * Coming back (with the browser's back button or the doujin page's link) scrolls to where the
   * list was. The grid only knows its full height once it has measured its columns, so this waits
   * for it: scrolling earlier would stop short at the first few rows.
   */
  let scrollBack: number | undefined;
  let gridReady = false;

  // Either can come first: the grid may be measured before the navigation is reported, or after
  afterNavigate(({ type }) => {
    const returning = type === 'popstate' || page.state.returning === true;
    // Taken on every visit, so it's only ever applied to the first one after leaving
    const remembered = libraryReturn.takeScroll(page.url.pathname + page.url.search);
    scrollBack = returning ? remembered : undefined;
    if (gridReady) applyScrollBack();
  });

  function onGridReady() {
    gridReady = true;
    applyScrollBack();
  }

  function applyScrollBack() {
    if (scrollBack === undefined) return;
    const top = scrollBack;
    scrollBack = undefined;
    requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
  }
</script>

<svelte:head>
  <title>{data.query ? `${data.query} · hanamaru` : 'Library · hanamaru'}</title>
</svelte:head>

<div class="layout">
  <aside aria-label="Library filters">
    <nav class="filters">
      {#each filters as filter (filter.label)}
        <a
          href={withParams({ q: filter.query || null })}
          aria-current={isFilter(filter.query) ? 'page' : undefined}
        >
          <Icon name={filter.icon} size={16} />
          {filter.label}
        </a>
      {/each}
      {#if data.stats.missing}
        <a
          href={withParams({ q: 'is:missing' })}
          aria-current={isFilter('is:missing') ? 'page' : undefined}
        >
          <Icon name="alert" size={16} />
          Missing <span class="count">{data.stats.missing}</span>
        </a>
      {/if}
    </nav>

    <nav class="filters mobile-only" aria-label="Browse">
      <a href="/tags"><Icon name="tag" size={16} /> Tags</a>
      <a href="/collections"><Icon name="collection" size={16} /> Collections</a>
    </nav>

    {#if data.collections.length}
      <h2>Collections</h2>
      <nav class="filters">
        {#each data.collections as collection (collection.id)}
          {@const query = `in:"${collection.name}"`}
          <a href={withParams({ q: query })} aria-current={isFilter(query) ? 'page' : undefined}>
            <Icon name="collection" size={16} />
            <span class="name">{collection.name}</span>
            <span class="count">{collection.count}</span>
          </a>
        {/each}
      </nav>
    {/if}
  </aside>

  <div class="content">
    {#if !data.hasRoots}
      <section class="empty-library">
        <h1>Add your library</h1>
        <p class="muted">
          Choose the folders that hold your doujins. Image folders, ZIP, CBZ, RAR and 7z archives
          are all read in place.
        </p>
        <a class="tw:btn tw:btn-primary" href="/settings#library">
          <Icon name="folder" size={16} /> Add folder
        </a>
      </section>
    {:else}
      {#if data.continueReading.length}
        <section class="continue" aria-labelledby="continue-heading">
          <div class="section-head">
            <h2 id="continue-heading">Continue reading</h2>
            <a href={withParams({ q: 'is:reading' })}>See all</a>
          </div>
          <div class="row">
            {#each data.continueReading as gallery (gallery.id)}
              <div class="row-item"><GalleryCard {gallery} eager /></div>
            {/each}
          </div>
        </section>
      {/if}

      <div class="toolbar">
        <h1>
          {heading}
          <span class="result-count">{data.total.toLocaleString()}</span>
        </h1>
        <div class="controls">
          {#if data.sort === 'random'}
            <button
              type="button"
              class="tw:btn tw:btn-ghost tw:btn-sm"
              onclick={() => setSort('random')}
              title="Shuffle again"
            >
              <Icon name="random" size={15} /> Shuffle
            </button>
          {/if}
          <label class="size" title="Card size">
            <span class="visually-hidden">Card size</span>
            <input
              class="slim"
              type="range"
              min="120"
              max="300"
              step="10"
              bind:value={cardWidth}
              onchange={saveCardWidth}
            />
          </label>
          <label>
            <span class="visually-hidden">Sort by</span>
            <select
              class="tw:select tw:select-sm"
              value={data.sort}
              onchange={(event) => setSort(event.currentTarget.value)}
            >
              {#each SORTS as sort (sort.value)}
                <option value={sort.value}>{sort.label}</option>
              {/each}
            </select>
          </label>
        </div>
      </div>

      {#if data.total === 0}
        <div class="empty">
          {#if live.scan?.running}
            <p>Scanning your folders. Doujins appear here as they're found.</p>
          {:else if data.query}
            <p>No doujins match this search.</p>
            <a class="tw:btn tw:btn-sm" href="/">Clear search</a>
          {:else}
            <p>No doujins found in your library folders.</p>
            <a class="tw:btn tw:btn-sm" href="/settings#library">Library folders</a>
          {/if}
        </div>
      {:else}
        <GalleryGrid
          total={data.total}
          initial={data.items}
          params={gridParams}
          {cardWidth}
          onready={onGridReady}
        />
      {/if}
    {/if}
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 32px;
    max-width: 1800px;
    margin: 0 auto;
    padding: 24px 28px 64px;
  }

  aside {
    position: sticky;
    top: calc(var(--header-height) + 24px);
    align-self: start;
    max-height: calc(100vh - var(--header-height) - 48px);
    overflow: auto;
  }

  aside h2 {
    margin: 24px 10px 6px;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .filters a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-weight: 500;
    text-decoration: none;
  }

  .filters a:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .filters a[aria-current='page'] {
    background: var(--surface-raised);
    color: var(--text);
  }

  .filters a[aria-current='page'] :global(svg) {
    color: var(--accent-text);
  }

  .filters .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    margin-left: auto;
    color: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .mobile-only {
    display: none;
  }

  .continue {
    margin-bottom: 36px;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .section-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .section-head a {
    color: var(--text-muted);
    font-size: 13px;
    text-decoration: none;
  }

  .section-head a:hover {
    color: var(--text);
    text-decoration: underline;
  }

  .row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 132px;
    gap: 16px;
    padding-bottom: 4px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }

  .row-item {
    scroll-snap-align: start;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }

  .toolbar h1 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .result-count {
    color: var(--text-faint);
    font-size: 14px;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .size {
    display: flex;
  }

  .size input {
    width: 96px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 32px 0;
    color: var(--text-muted);
  }

  .empty p {
    margin: 0;
  }

  .empty-library {
    max-width: 460px;
    padding: 48px 0;
  }

  .empty-library h1 {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
  }

  .empty-library p {
    margin: 0 0 20px;
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      padding: 12px 12px 40px;
    }

    aside {
      position: static;
      max-height: none;
      overflow: visible;
    }

    aside h2 {
      display: none;
    }

    aside {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .filters {
      flex-direction: row;
    }

    .filters.mobile-only {
      display: flex;
    }

    /* Collections are reachable from their own page on phones */
    aside h2 + .filters {
      display: none;
    }

    .filters a {
      flex: none;
      min-height: 34px;
      border: 1px solid var(--border-subtle);
      background: var(--surface);
      white-space: nowrap;
    }

    .size {
      display: none;
    }

    .row {
      grid-auto-columns: 112px;
    }

    .toolbar h1 {
      font-size: 17px;
    }
  }
</style>
