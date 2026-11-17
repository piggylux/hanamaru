<script lang="ts">
  import Icon from './Icon.svelte';

  let { label, onclick }: { label: string; onclick: () => void } = $props();
</script>

<button type="button" class="close-button" aria-label={label} title={label} {onclick}>
  <Icon name="close" />
</button>

<style>
  .close-button {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .close-button:hover {
    background: var(--surface-muted);
    color: var(--text);
  }
</style>
