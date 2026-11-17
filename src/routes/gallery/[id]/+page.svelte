<script lang="ts">
  import { afterNavigate, invalidate, replaceState } from '$app/navigation';
  import { page } from '$app/state';

  import { coverUrl, pageThumbUrl, searchUrl, tagQuery } from '#lib/api.js';
  import CollectionsDialog from '#lib/components/CollectionsDialog.svelte';
  import EditMetadataDialog from '#lib/components/EditMetadataDialog.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { engine } from '#lib/engine/client.js';
  import { count, displayName } from '#lib/format.js';
  import { libraryReturn, openRememberedList, opensElsewhere } from '#lib/return.svelte.js';
  import { groupTags } from '#lib/tags.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const gallery = $derived(data.gallery);

  let editing = $state(false);
  let choosingCollections = $state(false);
  let error = $state('');

  const started = $derived(gallery.lastPage > 0 && gallery.lastPage < gallery.pageCount - 1);
  const groups = $derived(groupTags(gallery.tags));
  const credits = $derived(
    ['artist', 'group'].flatMap((namespace) =>
      gallery.tags
        .filter((tag) => tag.namespace === namespace)
        .map((tag) => ({ ...tag, label: displayName(tag.name) }))
    )
  );
  const kindLabel = $derived(
    { folder: 'Folder', zip: 'ZIP', rar: 'RAR', '7z': '7z' }[gallery.kind]
  );
  const ehUrl = $derived(
    gallery.ehGid && gallery.ehToken
      ? `https://e-hentai.org/g/${gallery.ehGid}/${gallery.ehToken}/`
      : null
  );

  async function update(body: { favorite?: boolean; rating?: number | null }) {
    error = '';
    try {
      await engine.updateGallery(gallery.id, body);
      await invalidate('app:gallery');
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function startOver() {
    await engine.resetProgress(gallery.id);
    await invalidate('app:gallery');
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  /** The list this doujin was opened from: a search, a filter, a collection, or the library */
  const back = $derived(libraryReturn.place ?? { url: '/', heading: 'Library', scrollY: 0 });

  // Opened straight from that list, going back is a step back in history, which also keeps the
  // browser's own back button in step. It's noted on this history entry, so it still holds after
  // reading and coming back.
  const cameFromList = $derived(page.state.fromList === true);
  afterNavigate(({ from, type }) => {
    if (type === 'popstate' || !from) return;
    if (from.url.pathname + from.url.search === back.url) {
      replaceState('', { ...page.state, fromList: true });
    }
  });

  function goBack() {
    if (cameFromList) history.back();
    else openRememberedList();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Escape closes an open dialog first; only then does it leave the page
    if (document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select')) return;
    event.preventDefault();
    goBack();
  }
</script>

<svelte:window {onkeydown} />

<svelte:head>
  <title>{gallery.title} · hanamaru</title>
</svelte:head>

<article class="page">
  <a
    class="back"
    href={back.url}
    onclick={(event) => {
      if (opensElsewhere(event)) return;
      event.preventDefault();
      goBack();
    }}
    title="Back (Esc)"
  >
    <Icon name="back" size={16} />
    <span>{back.heading}</span>
  </a>

  <div class="hero">
    <a class="cover" href={`/read/${gallery.id}`} aria-label={`Read ${gallery.title}`}>
      <img src={coverUrl(gallery.id, gallery.version)} alt="" />
    </a>

    <div class="details">
      <h1>{gallery.title}</h1>
      {#if gallery.titleJpn}<p class="title-jpn" lang="ja">{gallery.titleJpn}</p>{/if}

      {#if credits.length}
        <p class="credits">
          {#each credits as credit, index (`${credit.namespace}:${credit.name}`)}
            <a href={searchUrl(tagQuery(credit.namespace, credit.name))}>{credit.label}</a>{index <
            credits.length - 1
              ? ', '
              : ''}
          {/each}
        </p>
      {/if}

      <div class="facts">
        <span>{count(gallery.pageCount, 'page')}</span>
        <span>{kindLabel}</span>
        {#if gallery.category}<span>{gallery.category}</span>{/if}
        <span>Added {dateFormat.format(gallery.addedAt)}</span>
        {#if gallery.readCount > 0}
          <span>Read {gallery.readCount === 1 ? 'once' : `${gallery.readCount} times`}</span>
        {/if}
        <span class="rating" role="group" aria-label="Rating">
          {#each [1, 2, 3, 4, 5] as star (star)}
            <button
              type="button"
              aria-label={`Rate ${star} out of 5`}
              aria-pressed={gallery.rating === star}
              class:on={(gallery.rating ?? 0) >= star}
              onclick={() => update({ rating: gallery.rating === star ? null : star })}
            >
              <Icon name="star" size={15} filled={(gallery.rating ?? 0) >= star} />
            </button>
          {/each}
        </span>
      </div>

      {#if gallery.missing}
        <p class="notice" role="status">
          <Icon name="alert" size={16} />
          Not found at the last scan. Its details are kept in case it comes back.
        </p>
      {/if}

      <div class="actions">
        {#if !gallery.missing}
          <a class="tw:btn tw:btn-primary" href={`/read/${gallery.id}${started ? '' : '?page=0'}`}>
            <Icon name="book" size={16} />
            {started ? `Continue · page ${gallery.lastPage + 1}` : 'Read'}
          </a>
        {/if}
        {#if started || gallery.readCount > 0}
          <button type="button" class="tw:btn" onclick={startOver}>
            <Icon name="refresh" size={16} /> Start over
          </button>
        {/if}
        <button
          type="button"
          class="tw:btn favorite"
          class:on={gallery.favorite}
          aria-pressed={gallery.favorite}
          onclick={() => update({ favorite: !gallery.favorite })}
        >
          <Icon name="heart" size={16} filled={gallery.favorite} />
          Favorite
        </button>

        <span class="divider" aria-hidden="true"></span>

        <button
          type="button"
          class="tw:btn tw:btn-ghost"
          onclick={() => (editing = true)}
          title="Edit details"
        >
          <Icon name="edit" size={16} /> Edit
        </button>
        <button
          type="button"
          class="tw:btn tw:btn-ghost"
          onclick={() => (choosingCollections = true)}
        >
          <Icon name="collection" size={16} /> Collections
        </button>
      </div>

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      {#if groups.length}
        <dl class="tags">
          {#each groups as group (group.namespace)}
            <dt>{displayName(group.namespace)}</dt>
            <dd>
              {#each group.names as name (name)}
                <a class="chip" href={searchUrl(tagQuery(group.namespace, name))}>{name}</a>
              {/each}
            </dd>
          {/each}
          {#if gallery.collections.length}
            <dt>Collections</dt>
            <dd>
              {#each gallery.collections as collection (collection.id)}
                <a class="chip" href={searchUrl(`in:"${collection.name}"`)}>{collection.name}</a>
              {/each}
            </dd>
          {/if}
        </dl>
      {:else}
        <p class="muted no-tags">No tags yet.</p>
      {/if}

      <p class="location">
        <span class="path" title={gallery.path}>{gallery.path}</span>
        {#if ehUrl}
          <a href={ehUrl} target="_blank" rel="noreferrer noopener">
            E-Hentai <Icon name="external" size={13} />
          </a>
        {/if}
      </p>
    </div>
  </div>

  {#if !gallery.missing}
    <section aria-labelledby="pages-heading">
      <h2 id="pages-heading">Pages <span>{gallery.pageCount}</span></h2>
      <ol class="pages">
        {#each { length: gallery.pageCount } as _, index (index)}
          <li>
            <a
              href={`/read/${gallery.id}?page=${index}`}
              aria-label={`Page ${index + 1}`}
              class:current={started && index === gallery.lastPage}
            >
              <img
                src={pageThumbUrl(gallery.id, index, gallery.version)}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <span>{index + 1}</span>
            </a>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</article>

<EditMetadataDialog bind:open={editing} {gallery} />
<CollectionsDialog bind:open={choosingCollections} {gallery} collections={data.collections} />

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    /* A full-size touch target, with margins that keep the text where a smaller link would be */
    min-height: 44px;
    margin: -14px 0 10px -8px;
    padding: 0 10px 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-weight: 500;
    text-decoration: none;
  }

  .back span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .back:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .hero {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 36px;
    align-items: start;
  }

  .cover {
    position: relative;
    display: block;
    overflow: hidden;
    aspect-ratio: 5 / 7;
    border-radius: var(--radius-cover);
    background: var(--surface-raised);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.08),
      0 8px 24px rgb(0 0 0 / 0.08);
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .title-jpn {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  .credits {
    margin: 10px 0 0;
    font-size: 15px;
  }

  .credits a {
    color: var(--text);
    text-decoration: none;
  }

  .credits a:hover {
    text-decoration: underline;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 0;
    margin-top: 10px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .facts > span:not(:last-child)::after {
    content: '·';
    margin: 0 8px;
    color: var(--text-faint);
  }

  .rating {
    display: inline-flex;
  }

  .rating button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--border-strong);
    cursor: pointer;
  }

  .rating button.on {
    color: var(--accent);
  }

  .rating button:hover {
    color: var(--accent);
  }

  .notice,
  .error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 16px 0 0;
    color: var(--danger);
    font-size: 13px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 22px;
  }

  .divider {
    width: 1px;
    height: 22px;
    margin: 0 4px;
    background: var(--border-subtle);
  }

  .actions :global(.tw\:btn) {
    padding-inline: 12px;
  }

  .actions :global(.tw\:btn-ghost) {
    padding-inline: 10px;
  }

  .favorite.on {
    color: var(--favorite);
  }

  .tags {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px 16px;
    margin: 28px 0 0;
    padding-top: 22px;
    border-top: 1px solid var(--border-subtle);
  }

  dt {
    padding-top: 3px;
    color: var(--text-muted);
    font-size: 13px;
  }

  dd {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
  }

  .no-tags {
    margin: 28px 0 0;
    padding-top: 22px;
    border-top: 1px solid var(--border-subtle);
  }

  .location {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 24px 0 0;
    color: var(--text-faint);
    font-size: 12px;
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .location a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
  }

  .location a:hover {
    color: var(--text);
  }

  section h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 48px 0 14px;
    font-size: 15px;
    font-weight: 600;
  }

  section h2 span {
    color: var(--text-faint);
    font-size: 13px;
    font-weight: 400;
  }

  .pages {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pages a {
    display: block;
    color: var(--text-faint);
    text-decoration: none;
  }

  .pages img {
    display: block;
    width: 100%;
    aspect-ratio: 5 / 7;
    object-fit: cover;
    object-position: top center;
    border-radius: 4px;
    background: var(--surface-raised);
    outline: 1px solid rgb(0 0 0 / 0.08);
    outline-offset: -1px;
  }

  .pages a:hover img {
    outline: 2px solid var(--border-strong);
  }

  .pages a.current img {
    outline: 2px solid var(--accent);
  }

  .pages span {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    text-align: center;
  }

  .pages a.current span {
    color: var(--accent-text);
    font-weight: 600;
  }

  @media (max-width: 760px) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
    }

    .cover {
      width: min(200px, 60%);
    }

    h1 {
      font-size: 20px;
    }

    .divider {
      display: none;
    }

    .tags {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }

    dd {
      margin-bottom: 8px;
    }

    .pages {
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 10px;
    }
  }
</style>
