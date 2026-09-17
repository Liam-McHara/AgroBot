<script lang="ts">
  import { onMount } from 'svelte';
  import { meStore } from '../lib/stores/me.svelte.js';
  import { t } from '../lib/i18n/index.svelte.js';

  /**
   * The M0 placeholder screen: it proves the Mini App, the `tma` authorization header and
   * `GET /api/me` talk to each other. M1 replaces it with the gate and the navigation shell.
   */
  onMount(() => {
    void meStore.refetch();
  });
</script>

<main>
  {#if meStore.loading}
    <p class="hint">{t('common.loading')}</p>
  {:else if meStore.error}
    <p class="error">{t('miniapp.error.load_failed')}</p>
    <p class="hint">{meStore.error.message}</p>
    <button type="button" onclick={() => meStore.refetch()}>{t('common.retry')}</button>
  {:else if meStore.me}
    <h1>{t('miniapp.hello', { name: meStore.me.displayName })}</h1>
    <p class="hint">{t('miniapp.hello.subtitle')}</p>
  {/if}
</main>

<style>
  main {
    padding: var(--agrobot-space);
    display: flex;
    flex-direction: column;
    gap: var(--agrobot-space);
    align-items: flex-start;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  p {
    margin: 0;
  }

  .hint {
    color: var(--agrobot-hint);
  }

  .error {
    color: var(--agrobot-destructive);
  }
</style>
