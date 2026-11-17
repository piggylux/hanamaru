<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status === 404 ? 'Not found' : 'Error'} · hanamaru</title>
</svelte:head>

<div class="error-page">
  <h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
  <p>{page.error?.message}</p>
  <a class="tw:btn tw:btn-sm" href="/">Library</a>
</div>

<style>
  .error-page {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    max-width: 520px;
    margin: 0 auto;
    padding: 12vh 24px 48px;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
  }

  p {
    margin: 0;
    color: var(--text-muted);
  }
</style>
