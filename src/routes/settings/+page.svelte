<script lang="ts">
  import { invalidate, invalidateAll } from '$app/navigation';

  import Dialog from '#lib/components/Dialog.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { allowAccess, engine, pickFolder } from '#lib/engine/client.js';
  import { count } from '#lib/format.js';
  import { live } from '#lib/live.svelte.js';
  import type { ImportResult, ReaderPrefs } from '#lib/types.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const SECTIONS = [
    { id: 'library', label: 'Library' },
    { id: 'reading', label: 'Reading' },
    { id: 'backup', label: 'Backup' },
    { id: 'storage', label: 'Storage' },
  ];

  const READER_OPTIONS = [
    {
      key: 'mode',
      label: 'Layout',
      choices: [
        { value: 'single', label: 'One page' },
        { value: 'double', label: 'Two pages' },
        { value: 'strip', label: 'Scroll' },
      ],
    },
    {
      key: 'fit',
      label: 'Page size',
      choices: [
        { value: 'contain', label: 'Fit' },
        { value: 'width', label: 'Width' },
        { value: 'original', label: 'Original' },
      ],
    },
    {
      key: 'direction',
      label: 'Direction',
      choices: [
        { value: 'rtl', label: 'Right to left' },
        { value: 'ltr', label: 'Left to right' },
      ],
    },
  ] as const;

  let adding = $state(false);
  let rootError = $state('');
  let removingRoot = $state<{ id: number; path: string; count: number } | undefined>();
  let removeRootOpen = $state(false);

  // svelte-ignore state_referenced_locally
  let reader = $state<ReaderPrefs>({ ...data.readerDefaults });
  let readerSaved = $state(false);

  let storageMessage = $state('');
  let purgeOpen = $state(false);

  type BackupFile = { name: string; data: unknown; galleries: number; exportedAt: Date | null };
  let backupFile = $state<BackupFile | undefined>();
  let importOpen = $state(false);
  let importing = $state(false);
  let backupMessage = $state('');
  let backupError = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  const reload = () => invalidate('app:settings');
  const needsAccess = (id: number) => data.needingAccess.includes(id);

  // A finished scan changes the counts shown here
  let seenVersion = live.libraryVersion;
  $effect(() => {
    if (live.libraryVersion !== seenVersion) {
      seenVersion = live.libraryVersion;
      reload();
    }
  });

  /** Opens the browser's folder picker, then adds and scans the folder chosen */
  async function addRoot() {
    rootError = '';
    adding = true;
    try {
      const folder = await pickFolder();
      if (folder) {
        await engine.addRoot(folder);
        await reload();
      }
    } catch (err) {
      rootError = (err as Error).message;
    } finally {
      adding = false;
    }
  }

  async function allow() {
    rootError = '';
    if (await allowAccess()) {
      await engine.scan();
      await invalidateAll();
    } else {
      rootError = 'hanamaru can only read folders the browser allows.';
    }
  }

  async function removeRoot() {
    if (!removingRoot) return;
    rootError = '';
    try {
      await engine.removeRoot(removingRoot.id);
      await invalidateAll();
    } catch (err) {
      rootError = (err as Error).message;
    } finally {
      removeRootOpen = false;
    }
  }

  async function saveReader() {
    await engine.setReaderDefaults(reader);
    readerSaved = true;
    setTimeout(() => (readerSaved = false), 2000);
  }

  /** Saves the backup as a file, named after today's date */
  async function exportBackup() {
    backupError = '';
    try {
      const backup = await engine.exportBackup();
      const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hanamaru-library-${backup.exportedAt.slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      backupError = (err as Error).message;
    }
  }

  /** Reads the chosen file and asks before importing it */
  async function chooseBackup(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    // Cleared so choosing the same file again opens the dialog again
    event.currentTarget.value = '';
    if (!file) return;
    backupError = '';
    backupMessage = '';
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      if (data.format !== 'hanamaru-library') throw new Error('Not a backup');
      const exportedAt = typeof data.exportedAt === 'string' ? new Date(data.exportedAt) : null;
      backupFile = {
        name: file.name,
        data,
        galleries: Array.isArray(data.galleries) ? data.galleries.length : 0,
        exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null,
      };
      importOpen = true;
    } catch {
      backupError = `${file.name} isn't a hanamaru library export.`;
    }
  }

  function describeImport(result: ImportResult) {
    const plural = (count: number) => (count === 1 ? 'doujin' : 'doujins');
    const parts: string[] = [];
    if (result.restored) parts.push(`Restored ${result.restored} ${plural(result.restored)}.`);
    if (result.waiting) {
      parts.push(
        result.restored
          ? `${result.waiting} more come back once a scan finds them.`
          : `${result.waiting} ${plural(result.waiting)} come back once a scan finds them.`
      );
    }
    if (!result.restored && !result.waiting) parts.push('There were no doujins to restore.');
    if (result.skipped) {
      parts.push(`${result.skipped} unreadable ${plural(result.skipped)} skipped.`);
    }
    return parts.join(' ');
  }

  async function importBackup() {
    if (!backupFile) return;
    importing = true;
    backupError = '';
    try {
      backupMessage = describeImport(await engine.importBackup(backupFile.data));
      await invalidateAll();
    } catch (err) {
      backupError = (err as Error).message;
    } finally {
      importing = false;
      importOpen = false;
      backupFile = undefined;
    }
  }

  async function forgetPending() {
    const removed = await engine.forgetPendingImports();
    backupMessage = `Stopped waiting for ${removed} imported ${removed === 1 ? 'doujin' : 'doujins'}.`;
    await reload();
  }

  async function purgeMissing() {
    const removed = await engine.removeMissing();
    purgeOpen = false;
    storageMessage = `Forgot ${removed} missing ${removed === 1 ? 'doujin' : 'doujins'}.`;
    await invalidateAll();
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const scan = $derived(live.scan);
  const size = (bytes: number) =>
    bytes > 1024 ** 3
      ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
      : `${Math.round(bytes / 1024 ** 2)} MB`;
</script>

<svelte:head>
  <title>Settings · hanamaru</title>
</svelte:head>

<div class="settings">
  <nav class="section-nav" aria-label="Settings sections">
    {#each SECTIONS as section (section.id)}
      <a href={`#${section.id}`}>{section.label}</a>
    {/each}
  </nav>

  <div class="sections">
    <h1 class="page-title">Settings</h1>

    <section id="library" aria-labelledby="library-heading">
      <header>
        <h2 id="library-heading">Library</h2>
        <p>Folders hanamaru reads doujins from. Your files are never changed.</p>
      </header>

      {#if data.roots.length}
        <ul class="list">
          {#each data.roots as root (root.id)}
            <li>
              <Icon name="folder" size={16} />
              <span class="grow path">{root.path}</span>
              {#if needsAccess(root.id)}
                <button type="button" class="tw:btn tw:btn-xs" onclick={allow}>
                  Allow access
                </button>
              {:else}
                <span class="faint">{count(root.count, 'doujin')}</span>
              {/if}
              <button
                type="button"
                class="tw:btn tw:btn-xs tw:btn-ghost"
                onclick={() => {
                  removingRoot = root;
                  removeRootOpen = true;
                }}
              >
                Remove
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="inline">
        <button
          type="button"
          class="tw:btn tw:btn-sm tw:btn-primary"
          disabled={adding}
          onclick={addRoot}
        >
          <Icon name="folder" size={15} /> Add folder…
        </button>
      </div>
      {#if rootError}<p class="error" role="alert">{rootError}</p>{/if}

      <div class="row">
        <div>
          <span class="row-label">Scan</span>
          <span class="row-help" role="status">
            {#if scan?.running}
              {scan.phase === 'walking'
                ? 'Looking through folders…'
                : `Reading ${scan.done} of ${scan.total}`}
            {:else if scan?.phase === 'done'}
              Last scan: {scan.added} new, {scan.updated} changed, {scan.moved} moved, {scan.missing}
              missing
            {:else if scan?.phase === 'failed'}
              Stopped: {scan.errors[0]}
            {:else}
              Runs on start and when a folder is added
            {/if}
          </span>
        </div>
        <button
          type="button"
          class="tw:btn tw:btn-sm"
          disabled={scan?.running || !data.roots.length}
          onclick={() => engine.scan()}
        >
          <Icon name="refresh" size={15} /> Scan now
        </button>
      </div>
      {#if scan && !scan.running && scan.unsupported}
        <p class="note">
          {count(scan.unsupported, 'RAR or 7z archive')} skipped: browsers can't open them. ZIP and CBZ
          archives and image folders work.
        </p>
      {/if}
      {#if scan && !scan.running && scan.errors.length}
        <details class="errors">
          <summary>{count(scan.errors.length, 'file')} couldn't be read</summary>
          <ul>
            {#each scan.errors.slice(0, 50) as message, index (index)}<li>{message}</li>{/each}
          </ul>
        </details>
      {/if}
    </section>

    <section id="reading" aria-labelledby="reading-heading">
      <header>
        <h2 id="reading-heading">
          Reading
          {#if readerSaved}<span class="saved" role="status">Saved</span>{/if}
        </h2>
        <p>Defaults for doujins you haven't opened yet. Each one remembers its own changes.</p>
      </header>
      {#each READER_OPTIONS as option (option.key)}
        <div class="row">
          <span class="row-label" id={`reader-${option.key}`}>{option.label}</span>
          <div class="segmented" role="radiogroup" aria-labelledby={`reader-${option.key}`}>
            {#each option.choices as choice (choice.value)}
              <label>
                <input
                  type="radio"
                  name={`reader-${option.key}`}
                  value={choice.value}
                  checked={reader[option.key] === choice.value}
                  onchange={() => {
                    reader = { ...reader, [option.key]: choice.value };
                    saveReader();
                  }}
                />
                {choice.label}
              </label>
            {/each}
          </div>
        </div>
      {/each}
    </section>

    <section id="backup" aria-labelledby="backup-heading">
      <header>
        <h2 id="backup-heading">Backup</h2>
        <p>
          Titles, tags, favorites, ratings, progress, collections and reading settings. Not the
          doujins themselves.
        </p>
      </header>
      <div class="row">
        <div>
          <span class="row-label">Export</span>
          <span class="row-help">Save everything to one file</span>
        </div>
        <button type="button" class="tw:btn tw:btn-sm" onclick={exportBackup}>
          <Icon name="download" size={15} /> Export
        </button>
      </div>
      <div class="row">
        <div>
          <span class="row-label">Import</span>
          <span class="row-help">Merge a backup into this library</span>
        </div>
        <button type="button" class="tw:btn tw:btn-sm" onclick={() => fileInput?.click()}>
          <Icon name="upload" size={15} /> Import…
        </button>
        <input
          bind:this={fileInput}
          type="file"
          accept=".json,application/json"
          class="visually-hidden"
          tabindex="-1"
          aria-hidden="true"
          onchange={chooseBackup}
        />
      </div>
      {#if data.pendingImports}
        <div class="row">
          <div>
            <span class="row-label">Waiting</span>
            <span class="row-help">
              {count(data.pendingImports, 'imported doujin')} not found yet. Restored when a scan finds
              them.
            </span>
          </div>
          <button type="button" class="tw:btn tw:btn-sm tw:btn-ghost" onclick={forgetPending}>
            Stop waiting
          </button>
        </div>
      {/if}
      {#if backupMessage}<p class="note" role="status">{backupMessage}</p>{/if}
      {#if backupError}<p class="error" role="alert">{backupError}</p>{/if}
    </section>

    <section id="storage" aria-labelledby="storage-heading">
      <header>
        <h2 id="storage-heading">Storage</h2>
        <p>
          The library's details and thumbnails, kept in this browser. Clearing the site's data
          deletes them: export a backup first.
        </p>
      </header>
      <div class="row">
        <div>
          <span class="row-label">In use</span>
          <span class="row-help">
            {data.storage.usage === undefined ? 'Unknown' : size(data.storage.usage)}
            {data.storage.persisted
              ? '· kept when space runs low'
              : '· the browser may clear it when space runs low'}
          </span>
        </div>
      </div>
      {#if data.stats.missing}
        <div class="row">
          <div>
            <span class="row-label">Missing doujins</span>
            <span class="row-help">
              {count(data.stats.missing, 'doujin')} not found at the last scan, details kept
            </span>
          </div>
          <button type="button" class="tw:btn tw:btn-sm" onclick={() => (purgeOpen = true)}>
            Forget
          </button>
        </div>
      {/if}
      {#if storageMessage}<p class="note" role="status">{storageMessage}</p>{/if}
    </section>
  </div>
</div>

<Dialog bind:open={importOpen} title="Import a backup">
  {#if backupFile}
    <p>
      <strong>{backupFile.name}</strong> has {backupFile.galleries}
      {backupFile.galleries === 1 ? 'doujin' : 'doujins'}{backupFile.exportedAt
        ? `, saved ${dateFormat.format(backupFile.exportedAt)}`
        : ''}.
    </p>
    <ul class="import-notes">
      <li>
        Doujins in your library get back their tags, titles, ratings and collections from the file.
        Favorites are kept from both, and progress from whichever was read more recently.
      </li>
      <li>Doujins that aren't in your library yet come back once a scan finds them.</li>
      <li>Library folders aren't in backups: add them above.</li>
    </ul>
  {/if}
  {#snippet footer()}
    <button type="button" class="tw:btn" disabled={importing} onclick={() => (importOpen = false)}>
      Cancel
    </button>
    <button type="button" class="tw:btn tw:btn-primary" disabled={importing} onclick={importBackup}>
      {importing ? 'Importing…' : 'Import'}
    </button>
  {/snippet}
</Dialog>

<Dialog bind:open={removeRootOpen} title="Remove library folder">
  <p>
    Stop reading <strong>{removingRoot?.path}</strong>? Your files stay where they are; hanamaru
    forgets the {removingRoot?.count} doujins in it, with their tags, favorites and progress.
  </p>
  {#snippet footer()}
    <button type="button" class="tw:btn" onclick={() => (removeRootOpen = false)}>Cancel</button>
    <button type="button" class="tw:btn tw:btn-error" onclick={removeRoot}>Remove folder</button>
  {/snippet}
</Dialog>

<Dialog bind:open={purgeOpen} title="Forget missing doujins">
  <p>
    Forget the {data.stats.missing} doujins that weren't found? Their tags and progress go too. If they
    come back later, they'll be added again as new.
  </p>
  {#snippet footer()}
    <button type="button" class="tw:btn" onclick={() => (purgeOpen = false)}>Cancel</button>
    <button type="button" class="tw:btn tw:btn-error" onclick={purgeMissing}>Forget them</button>
  {/snippet}
</Dialog>

<style>
  .settings {
    display: grid;
    grid-template-columns: 168px minmax(0, 720px);
    gap: 48px;
    justify-content: center;
    padding: 32px 32px 80px;
  }

  .section-nav {
    position: sticky;
    top: calc(var(--header-height) + 32px);
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-top: 44px;
  }

  .section-nav a {
    padding: 6px 10px;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    text-decoration: none;
  }

  .section-nav a:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .page-title {
    margin-bottom: 20px;
  }

  section {
    padding: 8px 0 36px;
    scroll-margin-top: calc(var(--header-height) + 24px);
  }

  section + section {
    padding-top: 28px;
    border-top: 1px solid var(--border-subtle);
  }

  section > header {
    margin-bottom: 8px;
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  section > header p {
    margin: 4px 0 0;
    color: var(--text-muted);
  }

  .saved {
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 400;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .row:last-of-type {
    border-bottom: none;
  }

  .row-label {
    display: block;
    font-weight: 500;
  }

  .row-help {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list {
    margin: 12px 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
  }

  .list li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 4px 6px 4px 12px;
    color: var(--text-muted);
  }

  .list li + li {
    border-top: 1px solid var(--border-subtle);
  }

  .list .path {
    color: var(--text);
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .faint {
    color: var(--text-faint);
    font-size: 13px;
    white-space: nowrap;
  }

  .inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .note {
    margin: 12px 0 0;
    color: var(--text-muted);
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 12px 0 0;
    color: var(--danger);
  }

  .errors {
    margin: 0 0 8px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .errors summary {
    cursor: pointer;
  }

  .errors li {
    overflow-wrap: anywhere;
  }

  .import-notes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 12px 0 0;
    padding-left: 20px;
    color: var(--text-muted);
  }

  @media (max-width: 900px) {
    .settings {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
      padding: 20px 16px 64px;
    }

    .section-nav {
      display: none;
    }
  }

  @media (max-width: 560px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }
  }
</style>
