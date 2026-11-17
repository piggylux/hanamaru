<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';

  import Header from '#lib/components/Header.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { allowAccess, engine } from '#lib/engine/client.js';

  import type { LayoutProps } from './$types';

  import './styles.css';
  import '../app.css';

  let { data, children }: LayoutProps = $props();

  // The reader takes the whole screen, without the header
  const immersive = $derived(page.route.id === '/read/[id]');

  let allowing = $state(false);
  let refused = $state(false);

  /** Asks the browser for the library folders again, then looks for what changed meanwhile */
  async function allow() {
    allowing = true;
    try {
      refused = !(await allowAccess());
      if (!refused) {
        await engine.scan();
        await invalidateAll();
      }
    } finally {
      allowing = false;
    }
  }
</script>

<svelte:head>
  <title>hanamaru</title>
</svelte:head>

{#snippet accessBanner()}
  <div class="access" class:floating={immersive} role="status">
    <Icon name="folder" size={16} />
    <span>
      {refused
        ? 'Without access, covers show but doujins can’t be opened.'
        : 'Allow hanamaru to read your library folders again.'}
    </span>
    <button
      type="button"
      class="tw:btn tw:btn-sm tw:btn-primary"
      disabled={allowing}
      onclick={allow}
    >
      Allow access
    </button>
  </div>
{/snippet}

{#if data.engine.status !== 'ready'}
  <main class="problem">
    <img src="/icon.svg" alt="" width="40" height="40" />
    {#if data.engine.status === 'unsupported'}
      <h1>Open hanamaru in Chrome or Edge on a computer</h1>
      <p>Only they let a website read a folder on your computer.</p>
    {:else if data.engine.status === 'busy'}
      <h1>hanamaru is open in another tab</h1>
      <p>Close it there, then reload this tab.</p>
      <button type="button" class="tw:btn" onclick={() => location.reload()}>Reload</button>
    {:else}
      <h1>hanamaru couldn’t start</h1>
      <p>{data.engine.message}</p>
      <button type="button" class="tw:btn" onclick={() => location.reload()}>Reload</button>
    {/if}
  </main>
{:else if immersive}
  {#if data.needsAccess}{@render accessBanner()}{/if}
  {@render children()}
{:else}
  <a class="skip-link" href="#main-content">Skip to content</a>
  <Header theme={data.theme} />
  {#if data.needsAccess}{@render accessBanner()}{/if}
  <main id="main-content">
    {@render children()}
  </main>
{/if}

<style>
  main {
    min-height: calc(100vh - var(--header-height));
  }

  .problem {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    max-width: 520px;
    min-height: 100vh;
    margin: 0 auto;
    padding: 18vh 24px 48px;
  }

  .problem h1 {
    margin: 8px 0 0;
    font-size: 22px;
    font-weight: 600;
  }

  .problem p {
    margin: 0;
    color: var(--text-muted);
  }

  .access {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    padding: 10px 28px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-raised);
    color: var(--text);
  }

  .access span {
    flex: 1;
    min-width: 200px;
  }

  /* Over the reader, which has no header to sit under */
  .access.floating {
    position: fixed;
    inset: 12px 12px auto;
    z-index: 50;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    box-shadow: var(--shadow-popover);
  }
</style>
