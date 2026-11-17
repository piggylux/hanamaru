<script lang="ts">
  import { invalidate } from '$app/navigation';

  import { coverUrl, searchUrl } from '#lib/api.js';
  import Dialog from '#lib/components/Dialog.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { engine } from '#lib/engine/client.js';
  import { count } from '#lib/format.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let name = $state('');
  let error = $state('');
  let renaming = $state<{ id: number; name: string } | undefined>();
  let renameOpen = $state(false);
  let removing = $state<{ id: number; name: string } | undefined>();
  let removeOpen = $state(false);

  async function run(task: () => Promise<unknown>) {
    error = '';
    try {
      await task();
      await invalidate('app:collections');
      return true;
    } catch (err) {
      error = (err as Error).message;
      return false;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (await run(() => engine.createCollection(name))) name = '';
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    const target = renaming;
    if (!target) return;
    if (await run(() => engine.renameCollection(target.id, target.name))) renameOpen = false;
  }

  async function remove() {
    const target = removing;
    if (!target) return;
    if (await run(() => engine.deleteCollection(target.id))) removeOpen = false;
  }
</script>

<svelte:head>
  <title>Collections · hanamaru</title>
</svelte:head>

<div class="page">
  <div class="page-header">
    <h1 class="page-title">Collections</h1>
    <form class="create" onsubmit={create}>
      <label class="visually-hidden" for="collection-name">New collection</label>
      <input
        id="collection-name"
        class="tw:input tw:input-sm"
        placeholder="New collection"
        bind:value={name}
      />
      <button type="submit" class="tw:btn tw:btn-sm tw:btn-primary" disabled={!name.trim()}>
        <Icon name="plus" size={15} /> Create
      </button>
    </form>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if !data.collections.length}
    <p class="muted">No collections yet. Create one here, or from a doujin's page.</p>
  {:else}
    <ul class="grid">
      {#each data.collections as collection (collection.id)}
        <li>
          <a class="cover" href={searchUrl(`in:"${collection.name}"`)}>
            {#if collection.coverId && collection.coverVersion}
              <img
                src={coverUrl(collection.coverId, collection.coverVersion)}
                alt=""
                loading="lazy"
              />
            {:else}
              <span class="empty-cover"><Icon name="collection" size={28} /></span>
            {/if}
          </a>
          <div class="info">
            <a class="name" href={searchUrl(`in:"${collection.name}"`)}>{collection.name}</a>
            <span class="count">{count(collection.count, 'doujin')}</span>
          </div>
          <div class="actions">
            <button
              type="button"
              class="tw:btn tw:btn-xs tw:btn-ghost"
              onclick={() => {
                renaming = { id: collection.id, name: collection.name };
                renameOpen = true;
              }}
            >
              Rename
            </button>
            <button
              type="button"
              class="tw:btn tw:btn-xs tw:btn-ghost"
              onclick={() => {
                removing = { id: collection.id, name: collection.name };
                removeOpen = true;
              }}
            >
              Delete
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Dialog bind:open={renameOpen} title="Rename collection">
  {#if renaming}
    <form id="rename-form" onsubmit={rename}>
      <label class="visually-hidden" for="rename-input">Name</label>
      <input id="rename-input" class="tw:input tw:w-full" bind:value={renaming.name} required />
    </form>
  {/if}
  {#snippet footer()}
    <button type="button" class="tw:btn" onclick={() => (renameOpen = false)}>Cancel</button>
    <button type="submit" form="rename-form" class="tw:btn tw:btn-primary">Rename</button>
  {/snippet}
</Dialog>

<Dialog bind:open={removeOpen} title="Delete collection">
  <p>Delete “{removing?.name}”? Its doujins stay in your library.</p>
  {#snippet footer()}
    <button type="button" class="tw:btn" onclick={() => (removeOpen = false)}>Cancel</button>
    <button type="button" class="tw:btn tw:btn-error" onclick={remove}>Delete</button>
  {/snippet}
</Dialog>

<style>
  .create {
    display: flex;
    gap: 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 24px 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .cover {
    position: relative;
    display: block;
    overflow: hidden;
    aspect-ratio: 5 / 7;
    border-radius: var(--radius-cover);
    background: var(--surface-raised);
    outline: 1px solid rgb(0 0 0 / 0.08);
    outline-offset: -1px;
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }

  .empty-cover {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-faint);
  }

  .info {
    display: flex;
    flex-direction: column;
    margin-top: 8px;
  }

  .name {
    font-weight: 500;
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .name:hover {
    text-decoration: underline;
  }

  .count {
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .actions {
    display: flex;
    gap: 2px;
    margin: 4px 0 0 -8px;
  }

  .error {
    color: var(--danger);
  }

  @media (max-width: 640px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
      gap: 18px 14px;
    }
  }
</style>
