<script lang="ts">
  import { coverUrl } from '#lib/api.js';
  import { count, displayName, languageCode } from '#lib/format.js';
  import type { GalleryCard } from '#lib/types.js';

  import Icon from './Icon.svelte';

  let { gallery, eager = false }: { gallery: GalleryCard; eager?: boolean } = $props();

  const reading = $derived(gallery.lastPage > 0 && gallery.lastPage < gallery.pageCount - 1);
  const progress = $derived(
    gallery.pageCount > 1 ? ((gallery.lastPage + 1) / gallery.pageCount) * 100 : 0
  );
  const credit = $derived(
    gallery.artists
      ?.split(', ')
      .map((name) => displayName(name))
      .join(', ')
  );
</script>

<a class="card" href={`/gallery/${gallery.id}`} class:missing={gallery.missing}>
  <div class="cover">
    <img
      src={coverUrl(gallery.id, gallery.version)}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
    {#if gallery.language}
      <span class="language" title={displayName(gallery.language)}>
        {languageCode(gallery.language)}
      </span>
    {/if}
    {#if gallery.favorite}
      <span class="favorite"><Icon name="heart" size={13} filled label="Favorite" /></span>
    {/if}
    {#if reading}
      <div class="progress" aria-hidden="true"><div style:width={`${progress}%`}></div></div>
    {/if}
  </div>
  <div class="info">
    <h3 title={gallery.title}>{gallery.title}</h3>
    <p class="credit">{credit ?? ' '}</p>
    <p class="meta">
      {count(gallery.pageCount, 'page')}
      {#if gallery.missing}
        · <span class="warning">Missing</span>
      {:else if reading}
        · Page {gallery.lastPage + 1}
      {:else if gallery.readCount > 0}
        · Read
      {/if}
    </p>
  </div>
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }

  .cover {
    position: relative;
    aspect-ratio: 5 / 7;
    overflow: hidden;
    border-radius: var(--radius-cover);
    background: var(--surface-raised);
  }

  /* A hairline edge so light covers don't melt into a light page */
  .cover::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
    pointer-events: none;
  }

  .card:hover .cover::after {
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.08),
      inset 0 0 0 999px rgb(255 255 255 / 0.05);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }

  .missing .cover {
    opacity: 0.45;
  }

  .language,
  .favorite {
    position: absolute;
    top: 6px;
    display: inline-grid;
    place-items: center;
    height: 20px;
    border-radius: 4px;
    background: rgb(9 9 11 / 0.66);
    color: #fff;
  }

  .language {
    left: 6px;
    padding: 0 5px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .favorite {
    right: 6px;
    width: 20px;
    color: #ff8fb0;
  }

  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgb(0 0 0 / 0.35);
  }

  .progress div {
    height: 100%;
    background: var(--accent);
  }

  .info {
    display: flex;
    flex-direction: column;
    height: var(--card-info-height, 82px);
    padding-top: 8px;
    overflow: hidden;
  }

  h3 {
    display: -webkit-box;
    margin: 0 0 2px;
    overflow: hidden;
    font-size: 13.5px;
    font-weight: 500;
    line-height: 1.35;
    letter-spacing: 0;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  p {
    margin: 0;
    overflow: hidden;
    font-size: 12.5px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .credit {
    color: var(--text-muted);
  }

  .meta {
    color: var(--text-faint);
  }

  .warning {
    color: var(--danger);
  }
</style>
