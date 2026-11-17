<script lang="ts">
  import { tick, untrack } from 'svelte';

  import { engine } from '#lib/engine/client.js';
  import type { GalleryCard as Card } from '#lib/types.js';
  import { getVisibleRange } from '#lib/virtual-grid.js';

  import GalleryCard from './GalleryCard.svelte';

  /**
   * Every gallery matching a search, however many: only the rows on screen are drawn, and the
   * rest are fetched in chunks as they scroll into view.
   */
  let {
    total,
    initial,
    params,
    cardWidth = 180,
    onready,
  }: {
    total: number;
    initial: Card[];
    params: string;
    cardWidth?: number;
    /** Called once the grid has its full height, so the page can scroll back into it */
    onready?: () => void;
  } = $props();

  const CHUNK = 120;
  const GAP = 16;
  const INFO_HEIGHT = 82;
  const FIRST_PAINT = 48;

  /** A slot for every gallery, filled with what the server sent and empty for the rest */
  function slots(first: Card[], count: number) {
    const next = Array.from({ length: count }, (): Card | undefined => undefined);
    first.forEach((item, index) => (next[index] = item));
    return next;
  }

  // Filled straight away, so the server-rendered page already shows the first covers
  // svelte-ignore state_referenced_locally
  let items = $state<(Card | undefined)[]>(slots(initial, total));
  let loading = new Set<number>();
  let grid: HTMLDivElement | undefined = $state();
  /** How many columns the browser laid out, and how wide each is */
  let layout = $state<{ columns: number; track: number } | undefined>();
  let gridTop = $state(0);
  let viewportHeight = $state(800);

  // A new search starts over from what the server sent with the page. What was first shown is
  // remembered so the effect's first run doesn't rebuild the slots it was just given.
  // svelte-ignore state_referenced_locally
  let shown = { initial, total, params };
  $effect(() => {
    const next = { initial, total, params };
    if (
      next.initial === shown.initial &&
      next.total === shown.total &&
      next.params === shown.params
    ) {
      return;
    }
    shown = next;
    untrack(() => {
      items = slots(next.initial, next.total);
      loading = new Set();
    });
  });

  /**
   * CSS decides the columns (see `.grid`), so the page is laid out right from its first paint,
   * before any script runs. The script reads the result back for its scrolling math.
   */
  function readLayout() {
    if (!grid) return;
    const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
    const next = { columns: Math.max(1, tracks.length), track: parseFloat(tracks[0]) || 0 };
    if (!layout || layout.columns !== next.columns || layout.track !== next.track) layout = next;
  }

  function readPosition() {
    if (!grid) return;
    gridTop = grid.getBoundingClientRect().top;
    viewportHeight = window.innerHeight;
  }

  // Scroll events can fire many times a frame; the position is read at most once per frame
  let positionFrame = 0;
  function onScroll() {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      readPosition();
    });
  }

  const rowStride = $derived(layout ? layout.track * 1.4 + INFO_HEIGHT + GAP : 0);
  const range = $derived(
    layout && rowStride
      ? getVisibleRange({
          itemCount: items.length,
          columns: layout.columns,
          rowStride,
          gridTop,
          viewportHeight,
          overscan: 2,
        })
      : // Before the layout is known, enough cards to fill a large screen
        { start: 0, end: Math.min(items.length, FIRST_PAINT), paddingTop: 0, paddingBottom: 0 }
  );

  $effect(() => {
    if (!grid) return;
    const observer = new ResizeObserver(() => {
      readLayout();
      readPosition();
    });
    observer.observe(grid);
    return () => observer.disconnect();
  });

  // A new card size changes the columns without resizing the grid
  $effect(() => {
    void cardWidth;
    untrack(() => {
      readLayout();
      readPosition();
    });
  });

  // Once the columns are known, the padding standing in for off-screen rows gives the grid its
  // full height: from then on, any position in it can be scrolled to
  let ready = false;
  $effect(() => {
    if (!layout || ready) return;
    ready = true;
    tick().then(() => onready?.());
  });

  // Fetches the chunks the visible rows need
  $effect(() => {
    const { start, end } = range;
    const query = params;
    untrack(() => {
      for (let chunk = Math.floor(start / CHUNK); chunk * CHUNK < end; chunk++) {
        const from = chunk * CHUNK;
        if (loading.has(chunk) || items.slice(from, Math.min(end, from + CHUNK)).every(Boolean)) {
          continue;
        }
        loading.add(chunk);
        const search = new URLSearchParams(query);
        engine
          .galleries({
            query: search.get('q') ?? '',
            sort: search.get('sort') ?? undefined,
            seed: Number(search.get('seed')) || 0,
            offset: from,
            limit: CHUNK,
          })
          .then(({ items: fetched }) => {
            if (query !== params) return;
            fetched.forEach((item, index) => (items[from + index] = item));
          })
          .catch(() => loading.delete(chunk));
      }
    });
  });
</script>

<svelte:window onscroll={onScroll} onresize={onScroll} />

<div class="frame">
  <div
    class="grid"
    bind:this={grid}
    style:--card-width={`${cardWidth}px`}
    style:--card-info-height={`${INFO_HEIGHT}px`}
    style:padding-top={`${range.paddingTop}px`}
    style:padding-bottom={`${range.paddingBottom}px`}
  >
    <!--
    Keyed by position: chunks load at different times, so if the library changes in between, the
    same gallery can briefly sit in two slots
  -->
    {#each items.slice(range.start, range.end) as item, offset (range.start + offset)}
      {#if item}
        <GalleryCard gallery={item} eager={range.start + offset < 12} />
      {:else}
        <div class="placeholder" aria-hidden="true">
          <div class="cover"></div>
          <div class="info">
            <div class="line"></div>
            <div class="line short"></div>
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .frame {
    container-type: inline-size;
  }

  /* As many columns of at least the chosen card width as fit */
  .grid {
    --track: var(--card-width);
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(var(--track), 100%), 1fr));
    gap: 16px;
  }

  /* Phones always get at least two covers side by side */
  @container (width < 600px) {
    .grid {
      --track: min(var(--card-width), 150px);
    }
  }

  .placeholder .cover {
    aspect-ratio: 5 / 7;
    border-radius: var(--radius-panel);
    background: var(--surface-raised);
  }

  /* As tall as a real card's details, so rows keep the height the scrolling math expects */
  .placeholder .info {
    height: var(--card-info-height);
    padding-top: 8px;
  }

  .placeholder .line {
    height: 12px;
    margin-top: 6px;
    border-radius: 4px;
    background: var(--surface-raised);
  }

  .placeholder .short {
    width: 60%;
  }
</style>
