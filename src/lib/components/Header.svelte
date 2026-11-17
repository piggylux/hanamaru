<script lang="ts">
  import { page } from '$app/state';

  import { live } from '#lib/live.svelte.js';

  import Icon, { type IconName } from './Icon.svelte';
  import SearchBox from './SearchBox.svelte';

  let { theme: initialTheme }: { theme: 'system' | 'light' | 'dark' } = $props();
  // svelte-ignore state_referenced_locally
  let theme = $state(initialTheme);

  const links: { href: string; label: string; icon: IconName }[] = [
    { href: '/', label: 'Library', icon: 'library' },
    { href: '/tags', label: 'Tags', icon: 'tag' },
    { href: '/collections', label: 'Collections', icon: 'collection' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ];

  const THEMES = ['system', 'light', 'dark'] as const;
  const themeIcon: Record<(typeof THEMES)[number], IconName> = {
    system: 'monitor',
    light: 'sun',
    dark: 'moon',
  };
  const themeLabel = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

  function cycleTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }

  const isCurrent = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  const scanning = $derived(live.scan?.running ? live.scan : undefined);
</script>

<header>
  <a class="brand" href="/" aria-label="hanamaru library">
    <img src="/icon.svg" alt="" width="22" height="22" />
    <span>hanamaru</span>
  </a>

  <div class="search-slot">
    <SearchBox />
  </div>

  <nav aria-label="Main">
    {#each links as link (link.href)}
      <a
        href={link.href}
        aria-current={isCurrent(link.href) ? 'page' : undefined}
        title={link.label}
      >
        <Icon name={link.icon} size={16} />
        <span class="label">{link.label}</span>
      </a>
    {/each}
  </nav>

  <button
    type="button"
    class="theme"
    onclick={cycleTheme}
    title={`${themeLabel[theme]} (click to change)`}
    aria-label={`${themeLabel[theme]}. Change theme`}
  >
    <Icon name={themeIcon[theme]} size={16} />
  </button>

  {#if scanning}
    <div class="scan" role="status">
      <div
        class="bar"
        style:width={scanning.total ? `${(scanning.done / scanning.total) * 100}%` : '12%'}
      ></div>
      <span class="visually-hidden">
        Scanning: {scanning.done} of {scanning.total || '…'}
      </span>
    </div>
  {/if}
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 20px;
    height: var(--header-height);
    padding: 0 20px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    text-decoration: none;
  }

  .search-slot {
    flex: 1;
    display: flex;
    min-width: 0;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  nav a,
  .theme {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 34px;
    height: 34px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }

  nav a:hover,
  .theme:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  nav a[aria-current='page'] {
    background: var(--surface-raised);
    color: var(--text);
  }

  .theme {
    padding: 0;
  }

  .scan {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
  }

  @media (max-width: 1000px) {
    .label {
      display: none;
    }

    nav a {
      padding: 0;
    }
  }

  @media (max-width: 640px) {
    header {
      gap: 8px;
      padding: 0 10px;
    }

    .brand span {
      display: none;
    }

    nav a[href='/collections'],
    nav a[href='/tags'] {
      display: none;
    }
  }
</style>
