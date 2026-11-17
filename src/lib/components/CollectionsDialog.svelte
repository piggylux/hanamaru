<script lang="ts">
  import { invalidate } from '$app/navigation';

  import { engine } from '#lib/engine/client.js';
  import type { GalleryDetail } from '#lib/types.js';

  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(false),
    gallery,
    collections,
  }: {
    open: boolean;
    gallery: GalleryDetail;
    collections: { id: number; name: string }[];
  } = $props();

  let name = $state('');
  let error = $state('');
  const inside = $derived(new Set(gallery.collections.map((collection) => collection.id)));

  async function toggle(collectionId: number, checked: boolean) {
    error = '';
    try {
      await engine.setInCollection(gallery.id, collectionId, checked);
      await invalidate('app:gallery');
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    error = '';
    try {
      const id = await engine.createCollection(name);
      name = '';
      await toggle(id, true);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<Dialog bind:open title="Collections">
  {#if collections.length}
    <ul>
      {#each collections as collection (collection.id)}
        <li>
          <label>
            <input
              type="checkbox"
              class="tw:checkbox tw:checkbox-primary"
              checked={inside.has(collection.id)}
              onchange={(event) => toggle(collection.id, event.currentTarget.checked)}
            />
            <span>{collection.name}</span>
          </label>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No collections yet.</p>
  {/if}
  <form onsubmit={create}>
    <label class="visually-hidden" for="new-collection">New collection</label>
    <input
      id="new-collection"
      class="tw:input tw:flex-1"
      placeholder="New collection"
      bind:value={name}
    />
    <button type="submit" class="tw:btn" disabled={!name.trim()}>
      <Icon name="plus" size={16} /> Create
    </button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</Dialog>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
  }

  label {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    cursor: pointer;
  }

  label:hover {
    background: var(--surface-muted);
  }

  form {
    display: flex;
    gap: 8px;
  }

  .muted {
    margin: 0 0 16px;
    color: var(--text-muted);
  }

  .error {
    margin: 12px 0 0;
    color: var(--danger);
  }
</style>
