<script lang="ts">
  import type { ReservationView } from '@agrobot/shared';
  import ReservationSummary from './ReservationSummary.svelte';

  /** PRD US-4.6: one row of *My reservations*; tapping it opens the reservation. */
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
  </button>
</li>

<style>
  li {
    list-style: none;
  }
  .row {
    display: block;
    width: 100%;
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
    text-align: left;
  }
</style>
