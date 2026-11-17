<script lang="ts">
  import type { Snippet } from 'svelte';

  import CloseButton from './CloseButton.svelte';

  /**
   * A native modal dialog: focus stays inside, Escape and the backdrop close it, and focus
   * returns to whatever opened it
   */
  let {
    open = $bindable(false),
    title,
    children,
    footer,
    wide = false,
  }: {
    open: boolean;
    title: string;
    children: Snippet;
    footer?: Snippet;
    wide?: boolean;
  } = $props();

  const uid = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();
  let pressStartedOnBackdrop = false;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="panel-dialog"
  class:wide
  aria-labelledby={`${uid}-title`}
  onclose={() => (open = false)}
  onpointerdown={(event) => (pressStartedOnBackdrop = event.target === dialog)}
  onclick={(event) => {
    // Only a click that started and ended on the backdrop closes it, not a drag out of the content
    if (event.target === dialog && pressStartedOnBackdrop) open = false;
  }}
>
  {#if open}
    <header>
      <h2 id={`${uid}-title`}>{title}</h2>
      <CloseButton label={`Close ${title}`} onclick={() => (open = false)} />
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  {/if}
</dialog>

<style>
  dialog[open] {
    display: flex;
    flex-direction: column;
  }

  dialog.wide {
    width: min(880px, calc(100vw - 32px));
  }

  header {
    position: sticky;
    top: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: calc(var(--dialog-padding) - 10px) calc(var(--dialog-padding) - 10px) 0
      var(--dialog-padding);
    background: var(--surface);
  }

  h2 {
    margin: 10px 0 0;
    font-size: 16px;
    font-weight: 600;
  }

  .body {
    padding: 12px var(--dialog-padding) var(--dialog-padding);
    overflow: auto;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px var(--dialog-padding) var(--dialog-padding);
    border-top: 1px solid var(--border-subtle);
  }
</style>
