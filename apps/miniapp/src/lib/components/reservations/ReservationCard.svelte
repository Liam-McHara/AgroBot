<script lang="ts">
  import type { ReservationView } from '@agrobot/shared';
  import { t } from '../../i18n/index.svelte.js';
  import ReservationSummary from './ReservationSummary.svelte';

  /**
   * PRD US-4.6: one row of *My reservations*, with the unread messages badge of its thread
   * (US-5.1); tapping it opens the reservation and its thread.
   */
  let {
    reservation,
    onopen,
  }: { reservation: ReservationView; onopen: (reservation: ReservationView) => void } = $props();
</script>

<li>
  <button
    type="button"
    class="row"
    data-testid="reservation"
    data-reservation-id={reservation.id}
    data-status={reservation.status}
    onclick={() => onopen(reservation)}
  >
    <ReservationSummary {reservation} />
    {#if reservation.unread > 0}
      <span
        class="unread"
        data-testid="reservation-unread"
        aria-label={t('thread.unread', { count: reservation.unread })}>{reservation.unread}</span
      >
    {/if}
  </button>
</li>

<style>
  li {
    list-style: none;
  }
  .row {
    position: relative;
    display: block;
    width: 100%;
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
    text-align: left;
  }
  .unread {
    position: absolute;
    top: 12px;
    right: 12px;
    min-width: 22px;
    height: 22px;
    padding: 0 7px;
    border-radius: 11px;
    background: var(--agrobot-button);
    color: var(--agrobot-button-text);
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 22px;
    text-align: center;
  }
</style>
