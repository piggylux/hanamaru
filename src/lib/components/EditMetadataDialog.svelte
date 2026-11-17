<script lang="ts">
  import { invalidate } from '$app/navigation';

  import { engine } from '#lib/engine/client.js';
  import { tagsToText, textToTags } from '#lib/tags.js';
  import type { GalleryDetail } from '#lib/types.js';

  import Dialog from './Dialog.svelte';

  let { open = $bindable(false), gallery }: { open: boolean; gallery: GalleryDetail } = $props();

  const uid = $props.id();
  let title = $state('');
  let titleJpn = $state('');
  let tags = $state('');
  let saving = $state(false);
  let error = $state('');

  // Starts from the gallery's current details each time it opens
  $effect(() => {
    if (open) {
      title = gallery.title;
      titleJpn = gallery.titleJpn ?? '';
      tags = tagsToText(gallery.tags);
      error = '';
    }
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = '';
    try {
      await engine.setMetadata(gallery.id, { title, titleJpn, tags: textToTags(tags) });
      await invalidate('app:gallery');
      open = false;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog bind:open title="Edit details">
  <form id={`${uid}-form`} onsubmit={save}>
    <label>
      <span>Title</span>
      <input class="tw:input tw:w-full" bind:value={title} required />
    </label>
    <label>
      <span>Japanese title</span>
      <input class="tw:input tw:w-full" bind:value={titleJpn} lang="ja" />
    </label>
    <label>
      <span>Tags</span>
      <textarea class="tw:textarea tw:w-full" rows="10" bind:value={tags} spellcheck="false"
      ></textarea>
      <small>
        One per line, as <code>namespace:name</code>. Saving replaces all tags, including those from
        the file name and E-Hentai.
      </small>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
  {#snippet footer()}
    <button type="button" class="tw:btn" onclick={() => (open = false)}>Cancel</button>
    <button type="submit" form={`${uid}-form`} class="tw:btn tw:btn-primary" disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  {/snippet}
</Dialog>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label > span {
    font-weight: 600;
  }

  small {
    color: var(--text-muted);
  }

  .error {
    margin: 0;
    color: var(--danger);
  }
</style>
