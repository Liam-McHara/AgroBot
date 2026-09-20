<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import {
    RESERVATION_SIDES,
    RESERVATION_STATES,
    type ReservationSide,
    type ReservationState,
    type ReservationView,
  } from '@agrobot/shared';
  import { fetchReservations } from '../lib/api/reservations.js';
  import ReservationCard from '../lib/components/reservations/ReservationCard.svelte';
  import Screen from '../lib/components/Screen.svelte';
  import { t } from '../lib/i18n/index.svelte.js';
  import { realtime } from '../lib/stores/realtime.svelte.js';
  import { toasts } from '../lib/stores/toast.svelte.js';

  /**
   * ARCH §12 `/reservations`, PRD US-4.6: incoming (I am the producer) and outgoing (I am the
   * requester), each split into active and closed (last 30 days). Refetches on
   * `reservation.changed` (ARCH §7) and on reconnect; an answer to an older tab is dropped.
   */
  let side = $state<ReservationSide>('incoming');
  let tab = $state<ReservationState>('active');
  let reservations = $state<ReservationView[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  let request = 0;

  async function load(): Promise<void> {
    const current = ++request;
    const [wantedSide, wantedTab] = [side, tab];
    try {
      const response = await fetchReservations(wantedSide, wantedTab);
      if (current !== request) return;
      reservations = response.reservations;
      failed = false;
    } catch (error) {
      if (current !== request) return;
      failed = true;
      toasts.error(error);
    } finally {
      if (current === request) loading = false;
    }
  }

  function show(nextSide: ReservationSide, nextTab: ReservationState): void {
    side = nextSide;
    tab = nextTab;
    loading = true;
    void load();
  }

  onMount(() => {
    void load();
    const unsubscribe = [
      realtime.on('reservation.changed', () => void load()),
      realtime.onReconnect(() => void load()),
    ];
    return () => {
      for (const off of unsubscribe) off();
    };
  });
</script>

<Screen title={t('nav.reservations')}>
  <div class="tabs" role="tablist" aria-label={t('nav.reservations')}>
    {#each RESERVATION_SIDES as candidate (candidate)}
      <button
        type="button"
        role="tab"
        aria-selected={side === candidate}
        class:selected={side === candidate}
        onclick={() => show(candidate, tab)}>{t(`reservations.tab.${candidate}`)}</button
      >
    {/each}
  </div>
  <div class="segmented" role="radiogroup" aria-label={t('reservations.state.active')}>
    {#each RESERVATION_STATES as candidate (candidate)}
      <button
        type="button"
        role="radio"
        aria-checked={tab === candidate}
        class:selected={tab === candidate}
        onclick={() => show(side, candidate)}>{t(`reservations.state.${candidate}`)}</button
      >
    {/each}
  </div>

  {#if loading}
    <p class="hint" role="status">{t('common.loading')}</p>
  {:else if failed && reservations.length === 0}
    <button type="button" class="secondary" onclick={() => show(side, tab)}
      >{t('common.retry')}</button
    >
  {:else if reservations.length === 0}
    <p class="hint" data-testid="reservations-empty">
      {t(`reservations.empty.${side}.${tab}`)}
    </p>
  {:else}
    <ul>
      {#each reservations as reservation (reservation.id)}
        <ReservationCard
          {reservation}
          onopen={(picked) => void push(`/reservations/${picked.id}`)}
        />
      {/each}
    </ul>
  {/if}
</Screen>

<style>
  .tabs {
    display: flex;
    gap: 8px;
    border-bottom: 1px solid rgb(0 0 0 / 0.08);
  }
  .tabs button {
    flex: 1;
    background: transparent;
    color: var(--agrobot-hint);
    border-radius: 0;
    border-bottom: 2px solid transparent;
  }
  .tabs button.selected {
    color: var(--agrobot-link);
    border-bottom-color: var(--agrobot-link);
  }
  .segmented {
    display: flex;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
    padding: 4px;
    gap: 4px;
  }
  .segmented button {
    flex: 1;
    background: transparent;
    color: var(--agrobot-text);
  }
  .segmented button.selected {
    background: var(--agrobot-button);
    color: var(--agrobot-button-text);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
  }
</style>
