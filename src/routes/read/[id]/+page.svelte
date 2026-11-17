<script lang="ts">
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { onMount, untrack } from 'svelte';

  import { pageUrl } from '#lib/api.js';
  import Icon, { type IconName } from '#lib/components/Icon.svelte';
  import { engine } from '#lib/engine/client.js';
  import { libraryReturn, openRememberedList, opensElsewhere } from '#lib/return.svelte.js';
  import { buildSpreads, spreadOf, stepFor } from '#lib/spreads.js';
  import type { PageInfo, ReaderFit, ReaderMode, ReaderPrefs } from '#lib/types.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const gallery = $derived(data.gallery);

  // svelte-ignore state_referenced_locally
  let prefs = $state<ReaderPrefs>({ ...data.prefs });
  // svelte-ignore state_referenced_locally
  let page = $state(data.startPage);
  let infos = $state<PageInfo[]>([]);
  let chromeVisible = $state(true);
  let finished = $state(false);
  let stage: HTMLDivElement | undefined = $state();
  let strip: HTMLDivElement | undefined = $state();

  $effect(() => {
    const count = gallery.pageCount;
    untrack(() => (infos = Array.from({ length: count }, () => ({ width: null, height: null }))));
    data.pages
      .then((measured) => {
        infos = measured;
        // Real page heights move strip mode's pages: keep the current one in view
        if (prefs.mode === 'strip') requestAnimationFrame(() => scrollToPage(page, 'instant'));
      })
      .catch(() => {});
  });

  const spreads = $derived(
    prefs.mode === 'double' ? buildSpreads(infos, prefs.shift) : infos.map((_, index) => [index])
  );
  const spreadIndex = $derived(spreadOf(spreads, page));
  const spread = $derived(spreads[spreadIndex] ?? [page]);
  const label = $derived(
    spread.length > 1
      ? `${spread[0] + 1}–${spread.at(-1)! + 1} / ${gallery.pageCount}`
      : `${page + 1} / ${gallery.pageCount}`
  );
  const url = (index: number) => pageUrl(gallery.id, index, gallery.version);

  function go(step: number) {
    if (prefs.mode === 'strip') {
      scrollToPage(Math.min(Math.max(page + step, 0), gallery.pageCount - 1));
      return;
    }
    const target = spreadIndex + step;
    if (target >= spreads.length) {
      finished = true;
      return;
    }
    finished = false;
    if (target < 0) return;
    page = spreads[target][0];
    stage?.scrollTo({ top: 0, left: 0 });
  }

  function jump(index: number) {
    finished = false;
    if (prefs.mode === 'strip') scrollToPage(index);
    else page = spreads[spreadOf(spreads, index)][0];
  }

  function scrollToPage(index: number, behavior: ScrollBehavior = 'smooth') {
    strip
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ behavior, block: 'start' });
  }

  // Keeps the spread aligned when the layout changes, and opens strip mode at the current page
  $effect(() => {
    const mode = prefs.mode;
    untrack(() => {
      if (mode === 'strip') requestAnimationFrame(() => scrollToPage(page, 'instant'));
      else page = spreads[spreadOf(spreads, page)]?.[0] ?? page;
    });
  });

  /**
   * The place to remember: the last page on screen, so reaching the final spread counts the book
   * as read, and reopening shows the same spread
   */
  const place = $derived(prefs.mode === 'strip' ? page : (spread.at(-1) ?? page));

  // svelte-ignore state_referenced_locally
  let saved = data.startPage;

  /**
   * Remembers the place as soon as the page turns. A save is one quick write in the engine's
   * worker, and waiting would lose the last turn when the tab closes: the worker closes with it.
   */
  function saveNow() {
    if (place === saved) return;
    saved = place;
    engine.saveProgress(gallery.id, place).catch(() => {});
  }

  $effect(() => {
    void place;
    untrack(saveNow);
  });

  beforeNavigate(saveNow);

  // Opened from the doujin's page, leaving is a step back in history rather than a new page, so
  // the browser's back button then returns to the list it came from
  let cameFromDetails = false;
  afterNavigate(({ from }) => {
    cameFromDetails = from?.url.pathname === `/gallery/${gallery.id}`;
  });

  function backToDetails() {
    if (cameFromDetails) history.back();
    else goto(`/gallery/${gallery.id}`);
  }
  onMount(() => {
    const onHide = () => saveNow();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  });

  // Loads the next pages ahead, and the one before, so turning is instant
  const preloaded = new Map<number, HTMLImageElement>();
  $effect(() => {
    if (prefs.mode === 'strip') return;
    const wanted = new Set<number>();
    for (let offset = -1; offset <= 3; offset++) {
      for (const index of spreads[spreadIndex + offset] ?? []) wanted.add(index);
    }
    untrack(() => {
      for (const index of wanted) {
        if (preloaded.has(index)) continue;
        const image = new Image();
        image.decoding = 'async';
        image.src = url(index);
        preloaded.set(index, image);
      }
      for (const index of preloaded.keys()) if (!wanted.has(index)) preloaded.delete(index);
    });
  });

  // Strip mode follows whichever page crosses the middle of the screen
  $effect(() => {
    if (prefs.mode !== 'strip' || !strip) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) page = Number((entry.target as HTMLElement).dataset.index);
        }
      },
      { rootMargin: '-50% 0px -50% 0px' }
    );
    for (const element of strip.querySelectorAll('[data-index]')) observer.observe(element);
    return () => observer.disconnect();
  });

  function savePrefs(changes: Partial<ReaderPrefs>) {
    prefs = { ...prefs, ...changes };
    engine.updateGallery(gallery.id, { readerPrefs: prefs }).catch(() => {});
  }

  // The controls fade away while reading, and come back with the mouse or a tap in the middle
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  function showChrome(duration = 2500) {
    chromeVisible = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (chromeVisible = false), duration);
  }
  onMount(() => {
    showChrome(3000);
    return () => clearTimeout(hideTimer);
  });

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Not allowed here, such as in an embedded browser
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, select, textarea')) return;
    const strip = prefs.mode === 'strip';
    const pagesFit = prefs.fit === 'contain';
    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        go(stepFor('left', prefs.direction));
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        go(stepFor('right', prefs.direction));
        break;
      case ' ':
        if (strip) return;
        go(event.shiftKey ? -1 : 1);
        break;
      case 'PageDown':
        go(1);
        break;
      case 'PageUp':
        go(-1);
        break;
      case 'ArrowDown':
        if (strip || !pagesFit) return;
        go(1);
        break;
      case 'ArrowUp':
        if (strip || !pagesFit) return;
        go(-1);
        break;
      case 'Home':
        jump(0);
        break;
      case 'End':
        jump(gallery.pageCount - 1);
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'Escape':
        if (finished) finished = false;
        else backToDetails();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * A click turns the page toward the half of the screen it lands on, whichever way the book
   * reads. Touch screens have no hover to bring the controls back, so there a tap in the middle
   * third shows or hides them instead.
   */
  let pointerStart: { x: number; y: number; time: number; type: string } | undefined;
  let swiped = false;
  /** The half of the screen the mouse is over, so the cursor shows which way a click goes */
  let hoverSide = $state<'left' | 'right' | undefined>();

  const arrowCursor = (path: string) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='13' fill='rgba(14,15,18,0.65)' stroke='white' stroke-width='1.5'/><path d='${path}' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, pointer`;
  };
  const CURSORS = {
    left: arrowCursor('M18.5 10l-6 6 6 6'),
    right: arrowCursor('M13.5 10l6 6-6 6'),
  };

  function onpointerdown(event: PointerEvent) {
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      type: event.pointerType,
    };
    swiped = false;
  }

  function onpointermove(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    hoverSide = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
  }

  function onpointerup(event: PointerEvent) {
    if (!pointerStart || event.pointerType === 'mouse') return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 80 && Date.now() - pointerStart.time < 600) {
      swiped = true;
      // Swiping drags the page away: toward the right moves forward in right-to-left books
      go(stepFor(dx > 0 ? 'left' : 'right', prefs.direction));
    }
  }

  function onStageClick(event: MouseEvent) {
    if (swiped) return;
    if (window.getSelection()?.toString()) return;
    const ratio = event.clientX / window.innerWidth;
    const touch = pointerStart !== undefined && pointerStart.type !== 'mouse';
    if (touch && ratio > 1 / 3 && ratio < 2 / 3) {
      if (chromeVisible) chromeVisible = false;
      else showChrome(4000);
      return;
    }
    go(stepFor(ratio < 0.5 ? 'left' : 'right', prefs.direction));
  }

  let lastWheel = 0;
  function onwheel(event: WheelEvent) {
    if (prefs.mode === 'strip' || prefs.fit !== 'contain' || event.ctrlKey) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheel < 250 || Math.abs(event.deltaY) < 4) return;
    lastWheel = now;
    go(event.deltaY > 0 ? 1 : -1);
  }

  const MODES: { value: ReaderMode; label: string; icon: IconName }[] = [
    { value: 'single', label: 'One page', icon: 'single' },
    { value: 'double', label: 'Two pages', icon: 'double' },
    { value: 'strip', label: 'Scroll', icon: 'strip' },
  ];
  const FITS: { value: ReaderFit; label: string }[] = [
    { value: 'contain', label: 'Fit' },
    { value: 'width', label: 'Width' },
    { value: 'original', label: 'Original' },
  ];
</script>

<svelte:head>
  <title>{gallery.title} · hanamaru</title>
</svelte:head>

<svelte:window
  {onkeydown}
  onmousemove={(event) => {
    if (event.clientY < 90 || event.clientY > window.innerHeight - 90) showChrome();
  }}
/>

<div class="reader" data-fit={prefs.fit} data-mode={prefs.mode}>
  {#if prefs.mode === 'strip'}
    <div
      class="strip"
      bind:this={strip}
      onclick={onStageClick}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      style:cursor={hoverSide && CURSORS[hoverSide]}
      role="presentation"
    >
      {#each infos as info, index (index)}
        <img
          data-index={index}
          src={url(index)}
          alt={`Page ${index + 1}`}
          loading={Math.abs(index - data.startPage) < 3 ? 'eager' : 'lazy'}
          decoding="async"
          style:aspect-ratio={info.width && info.height
            ? `${info.width} / ${info.height}`
            : '5 / 7'}
        />
      {/each}
    </div>
  {:else}
    <div
      class="stage"
      bind:this={stage}
      onclick={onStageClick}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      {onwheel}
      style:cursor={hoverSide && CURSORS[hoverSide]}
      role="presentation"
    >
      <div class="spread" class:rtl={prefs.direction === 'rtl'} class:pair={spread.length > 1}>
        {#each spread as index (index)}
          <img src={url(index)} alt={`Page ${index + 1}`} decoding="async" draggable="false" />
        {/each}
      </div>
    </div>
  {/if}

  <header class="chrome top" class:visible={chromeVisible || finished}>
    <a
      class="icon-button"
      href={`/gallery/${gallery.id}`}
      onclick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        backToDetails();
      }}
      aria-label="Back to the doujin"
      title="Back (Esc)"
    >
      <Icon name="back" />
    </a>
    <h1 title={gallery.title}>{gallery.title}</h1>
    <div class="options">
      <div class="segmented" role="radiogroup" aria-label="Layout">
        {#each MODES as mode (mode.value)}
          <label title={mode.label}>
            <input
              type="radio"
              name="layout"
              value={mode.value}
              checked={prefs.mode === mode.value}
              onchange={() => savePrefs({ mode: mode.value })}
            />
            <Icon name={mode.icon} size={16} />
            <span class="visually-hidden">{mode.label}</span>
          </label>
        {/each}
      </div>
      <div class="segmented" role="radiogroup" aria-label="Page size">
        {#each FITS as fit (fit.value)}
          <label>
            <input
              type="radio"
              name="fit"
              value={fit.value}
              checked={prefs.fit === fit.value}
              onchange={() => savePrefs({ fit: fit.value })}
            />
            {fit.label}
          </label>
        {/each}
      </div>
      <button
        type="button"
        class="text-button"
        onclick={() => savePrefs({ direction: prefs.direction === 'rtl' ? 'ltr' : 'rtl' })}
        title={prefs.direction === 'rtl' ? 'Reading right to left' : 'Reading left to right'}
      >
        <Icon name="direction" size={15} />
        {prefs.direction === 'rtl' ? 'RTL' : 'LTR'}
      </button>
      {#if prefs.mode === 'double'}
        <button
          type="button"
          class="text-button"
          aria-pressed={prefs.shift}
          onclick={() => savePrefs({ shift: !prefs.shift })}
          title="Pair pages one later, for spreads that don't line up"
        >
          Shift
        </button>
      {/if}
    </div>
    <!-- Outside the options, so it stays beside the title when they wrap on a phone -->
    <button
      type="button"
      class="icon-button fullscreen"
      onclick={toggleFullscreen}
      aria-label="Full screen"
      title="Full screen (F)"
    >
      <Icon name="fullscreen" />
    </button>
  </header>

  <footer class="chrome bottom" class:visible={chromeVisible}>
    <button
      type="button"
      class="icon-button"
      aria-label={prefs.direction === 'rtl' ? 'Next page' : 'Previous page'}
      onclick={() => go(stepFor('left', prefs.direction))}
    >
      <Icon name="back" />
    </button>
    <label class="slider" dir={prefs.direction}>
      <span class="visually-hidden">Page</span>
      <input
        type="range"
        min="0"
        max={gallery.pageCount - 1}
        value={page}
        oninput={(event) => jump(Number(event.currentTarget.value))}
      />
    </label>
    <button
      type="button"
      class="icon-button"
      aria-label={prefs.direction === 'rtl' ? 'Previous page' : 'Next page'}
      onclick={() => go(stepFor('right', prefs.direction))}
    >
      <Icon name="forward" />
    </button>
    <span class="counter" aria-live="polite">{label}</span>
  </footer>

  {#if finished}
    <div class="end" role="dialog" aria-label="End of the book">
      <p class="end-title">End of the book</p>
      <p class="end-name">{gallery.title}</p>
      <div class="end-actions">
        <a class="tw:btn tw:btn-primary" href={`/gallery/${gallery.id}`}>Details</a>
        <!-- Back to the search or list the doujin was opened from -->
        <a
          class="tw:btn"
          href={libraryReturn.place?.url ?? '/'}
          onclick={(event) => {
            if (opensElsewhere(event)) return;
            event.preventDefault();
            openRememberedList();
          }}
        >
          Library
        </a>
        <button type="button" class="tw:btn tw:btn-ghost" onclick={() => jump(0)}>
          Read again
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .reader {
    position: fixed;
    inset: 0;
    background: #0b0b0d;
    color: var(--text);
    color-scheme: dark;
  }

  .stage,
  .strip {
    position: absolute;
    inset: 0;
    overflow: auto;
    overscroll-behavior: contain;
    -webkit-user-select: none;
    user-select: none;
  }

  .stage {
    display: flex;
  }

  .spread {
    display: flex;
    margin: auto;
  }

  .spread.rtl {
    flex-direction: row-reverse;
  }

  .spread img {
    display: block;
    -webkit-user-drag: none;
  }

  /* Fit screen: the whole spread shows at once */
  [data-fit='contain'] .spread img {
    max-height: 100dvh;
    max-width: 100vw;
    object-fit: contain;
  }

  [data-fit='contain'] .spread.pair img {
    max-width: 50vw;
  }

  /* Fit width: pages fill the width and scroll down */
  [data-fit='width'] .spread img {
    width: 100vw;
    height: auto;
  }

  [data-fit='width'] .spread.pair img {
    width: 50vw;
  }

  [data-fit='width'] .stage,
  [data-fit='original'] .stage {
    align-items: flex-start;
  }

  .strip {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .strip img {
    display: block;
    width: min(100%, 960px);
    height: auto;
    background: var(--surface-raised);
  }

  [data-fit='width'] .strip img {
    width: 100%;
  }

  [data-fit='original'] .strip img {
    width: auto;
    max-width: none;
  }

  .chrome {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: rgb(17 17 19 / 0.94);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
  }

  .chrome.visible,
  .chrome:focus-within {
    opacity: 1;
    pointer-events: auto;
  }

  .top {
    top: 0;
    padding-top: max(6px, env(safe-area-inset-top));
    border-bottom: 1px solid var(--border-subtle);
  }

  .bottom {
    bottom: 0;
    padding-bottom: max(6px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--border-subtle);
  }

  h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .counter {
    min-width: 64px;
    color: var(--text-muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .text-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .text-button:hover {
    background: var(--surface-hover);
  }

  .text-button[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }

  .icon-button {
    display: inline-grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .slider {
    flex: 1;
    display: flex;
    padding: 0 6px;
  }

  .slider input {
    width: 100%;
    accent-color: var(--accent);
  }

  .end {
    position: absolute;
    left: 50%;
    top: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(380px, calc(100vw - 32px));
    padding: 24px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-dialog);
    text-align: center;
    transform: translate(-50%, -50%);
  }

  .end-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .end-name {
    max-width: 100%;
    margin: 4px 0 18px;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .end-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  @media (max-width: 760px) {
    .top {
      flex-wrap: wrap;
    }

    .options {
      order: 3;
      width: 100%;
      justify-content: flex-start;
      padding: 2px 4px 4px;
    }
  }
</style>
