<script lang="ts">
  import { searchUrl, tagQuery } from '#lib/api.js';
  import { displayName } from '#lib/format.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let filter = $state('');

  const ORDER = [
    'artist',
    'group',
    'parody',
    'character',
    'female',
    'male',
    'mixed',
    'language',
    'event',
    'other',
  ];

  const groups = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    const byNamespace = new Map<string, typeof data.tags>();
    for (const tag of data.tags) {
      if (needle && !tag.name.includes(needle)) continue;
      const list = byNamespace.get(tag.namespace) ?? [];
      list.push(tag);
      byNamespace.set(tag.namespace, list);
    }
    const rank = (namespace: string) =>
      ORDER.includes(namespace) ? ORDER.indexOf(namespace) : ORDER.length;
    return [...byNamespace].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  });
</script>

<svelte:head>
  <title>Tags · hanamaru</title>
</svelte:head>

<div class="page">
  <div class="page-header">
    <h1 class="page-title">Tags <span class="total">{data.tags.length.toLocaleString()}</span></h1>
    <label class="filter">
      <span class="visually-hidden">Filter tags</span>
      <input class="tw:input tw:input-sm" type="search" placeholder="Filter" bind:value={filter} />
    </label>
  </div>

  {#if !data.tags.length}
    <p class="muted">Tags appear here once doujins are scanned.</p>
  {:else if !groups.length}
    <p class="muted">No tags contain “{filter}”.</p>
  {/if}

  {#each groups as [namespace, tags] (namespace)}
    <section aria-labelledby={`ns-${namespace}`}>
      <h2 id={`ns-${namespace}`}>
        {displayName(namespace)} <span>{tags.length}</span>
      </h2>
      <ul>
        {#each tags as tag (tag.name)}
          <li>
            <a class="chip" href={searchUrl(tagQuery(tag.namespace, tag.name))}>
              {tag.name} <span class="count">{tag.count}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .total,
  h2 span {
    color: var(--text-faint);
    font-size: 14px;
    font-weight: 400;
  }

  .filter input {
    width: 220px;
  }

  section {
    padding: 20px 0;
    border-top: 1px solid var(--border-subtle);
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
