<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  import { searchUrl, tagQuery } from '#lib/api.js';
  import { engine } from '#lib/engine/client.js';
  import type { Tag } from '#lib/types.js';

  import Icon from './Icon.svelte';

  type Suggestion = Tag & { count: number };

  const uid = $props.id();
  let query = $state(page.url.searchParams.get('q') ?? '');
  let suggestions = $state<Suggestion[]>([]);
  let active = $state(-1);
  let input: HTMLInputElement | undefined = $state();
  let request = 0;

  // Follows the address as people move between searches. On a doujin's page the search stays as
  // it was, so it's still there to change or run again
  $effect(() => {
    if (page.url.pathname === '/') query = page.url.searchParams.get('q') ?? '';
  });

  /**
   * The word being typed, which suggestions complete. After an opening quote, that is the whole
   * quoted value so far, spaces included, along with the namespace before the quote.
   */
  function currentWord(text: string) {
    const insideQuotes = (text.match(/"/g) ?? []).length % 2 === 1;
    const match = insideQuotes
      ? /(?:^|\s)(-?)(?:([a-z]+):)?"([^"]*)$/i.exec(text)
      : /(?:^|\s)(-?)(?:([a-z]+):)?([^\s:"]*)$/i.exec(text);
    if (!match) return undefined;
    const leadingSpace = match[0].length - match[0].trimStart().length;
    return {
      negate: match[1],
      namespace: match[2] ?? '',
      prefix: match[3].trimStart(),
      start: match.index + leadingSpace,
    };
  }

  let suggestTimer: ReturnType<typeof setTimeout> | undefined;

  async function suggest() {
    const word = currentWord(query);
    const id = ++request;
    if (!word || word.prefix.length < 2 || word.namespace === 'is' || word.namespace === 'in') {
      suggestions = [];
      return;
    }
    const namespace = word.namespace && word.namespace !== 'tag' ? word.namespace : undefined;
    try {
      const found: Suggestion[] = await engine.tags({ prefix: word.prefix, namespace, limit: 8 });
      if (id === request) {
        suggestions = found;
        active = -1;
      }
    } catch {
      suggestions = [];
    }
  }

  function choose(suggestion: Suggestion) {
    const word = currentWord(query);
    if (!word) return;
    query = `${query.slice(0, word.start)}${word.negate}${tagQuery(suggestion.namespace, suggestion.name)} `;
    suggestions = [];
    input?.focus();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    suggestions = [];
    const params = new URLSearchParams(page.url.pathname === '/' ? page.url.search : '');
    if (query.trim()) params.set('q', query.trim());
    else params.delete('q');
    const search = params.toString();
    goto(search ? `/?${search}` : searchUrl(''), { reset: false }).then(() =>
      window.scrollTo({ top: 0 })
    );
  }

  function onkeydown(event: KeyboardEvent) {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % suggestions.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + suggestions.length) % suggestions.length;
    } else if ((event.key === 'Enter' || event.key === 'Tab') && active >= 0) {
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === 'Escape') {
      suggestions = [];
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    // "/" jumps to the search box from anywhere that isn't already a text field
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable]')
    ) {
      return;
    }
    event.preventDefault();
    input?.focus();
  }}
/>

<form class="search" role="search" onsubmit={submit}>
  <label class="visually-hidden" for={`${uid}-input`}>Search the library</label>
  <Icon name="search" size={16} />
  <input
    bind:this={input}
    id={`${uid}-input`}
    type="search"
    placeholder="Search titles and tags…"
    autocomplete="off"
    spellcheck="false"
    role="combobox"
    aria-expanded={suggestions.length > 0}
    aria-controls={`${uid}-list`}
    aria-activedescendant={active >= 0 ? `${uid}-option-${active}` : undefined}
    bind:value={query}
    oninput={() => {
      // Suggestions wait for a pause in typing, rather than asking on every key
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(suggest, 120);
    }}
    {onkeydown}
    onblur={() => setTimeout(() => (suggestions = []), 150)}
  />
  {#if !query}<kbd aria-hidden="true">/</kbd>{/if}
  {#if suggestions.length}
    <ul id={`${uid}-list`} role="listbox" aria-label="Matching tags">
      {#each suggestions as suggestion, index (`${suggestion.namespace}:${suggestion.name}`)}
        <li
          id={`${uid}-option-${index}`}
          role="option"
          aria-selected={index === active}
          onpointerdown={(event) => {
            event.preventDefault();
            choose(suggestion);
          }}
        >
          <span class="namespace">{suggestion.namespace}</span>
          <span class="name">{suggestion.name}</span>
          <span class="count">{suggestion.count}</span>
        </li>
      {/each}
    </ul>
  {/if}
</form>

<style>
  .search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 480px;
    height: 34px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface-muted);
    color: var(--text-faint);
  }

  .search:focus-within {
    border-color: var(--border-strong);
    background: var(--surface);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  input::placeholder {
    color: var(--text-faint);
  }

  /* The browser's own clear button is blue and out of place; select-all and delete does the same */
  input::-webkit-search-cancel-button {
    display: none;
  }

  /* No keyboard shortcut to hint at on touch screens */
  @media (hover: none) {
    kbd {
      display: none;
    }
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
  }

  ul {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 30;
    margin: 0;
    padding: 6px;
    list-style: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
  }

  li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-height: 34px;
    padding: 7px 10px;
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
  }

  li[aria-selected='true'],
  li:hover {
    background: var(--surface-hover);
  }

  .namespace {
    min-width: 64px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  kbd {
    flex: none;
  }
</style>
