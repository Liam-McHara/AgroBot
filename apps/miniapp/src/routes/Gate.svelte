<script lang="ts">
  import { onMount } from 'svelte';
  import type { MemberStatus } from '@agrobot/shared';
  import { t } from '../lib/i18n/index.svelte.js';
  import { meStore } from '../lib/stores/me.svelte.js';

  /**
   * ARCH §12 `/gate`: the closed door of PRD §2 for applicants, rejected and suspended people.
   * It polls `GET /me` so an approval given while the screen is open lets them in without a
   * relaunch (SSE arrives in M3).
   */
  let { status }: { status: Exclude<MemberStatus, 'approved'> } = $props();

  const POLL_MS = 15_000;

  onMount(() => {
    const timer = setInterval(() => void meStore.refetch(), POLL_MS);
    return () => clearInterval(timer);
  });

  const icon = $derived({ pending: '⏳', rejected: '🚪', suspended: '⛔' }[status]);
</script>

<main data-testid="gate" data-status={status}>
  <div class="icon" aria-hidden="true">{icon}</div>
  <h1>{t(`gate.${status}.title`)}</h1>
  <p>{t(`gate.${status}.body`)}</p>
  <button type="button" class="secondary" onclick={() => meStore.refetch()}>
    {t('gate.refresh')}
  </button>
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--agrobot-space);
    padding: var(--agrobot-space);
    text-align: center;
  }

  .icon {
    font-size: 3rem;
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
  }

  p {
    margin: 0;
    color: var(--agrobot-hint);
    max-width: 32ch;
  }
</style>
