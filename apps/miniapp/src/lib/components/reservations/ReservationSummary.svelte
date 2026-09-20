<script lang="ts">
  import { unitName, type ReservationView } from '@agrobot/shared';
  import { language, t } from '../../i18n/index.svelte.js';
  import { productLabel } from '../../offers.js';
  import { statusTone } from '../../reservations.js';

  /**
   * PRD US-4.6 / US-5.1 header: product, quantity and unit, unit price and total (or *price
   * pending*), status, the counterpart, and the dates that matter for where it stands.
   */
  let { reservation, detail = false }: { reservation: ReservationView; detail?: boolean } =
    $props();

  const unit = $derived(unitName(language(), reservation.product.unitCode));
  const tone = $derived(statusTone(reservation.status));
</script>

<div class="summary" data-testid="reservation-summary">
  <div class="headline">
    <strong>{productLabel(reservation.product, language())}</strong>
    <span class="badge {tone}" data-testid="reservation-status"
      >{t(`reservation.status_label.${reservation.status}`)}</span
    >
  </div>
  <div class="facts">
    <span class="quantity"
      >{t('reservation.quantity', { quantity: reservation.quantity, unit })}</span
    >
    {#if reservation.unitPriceCents === null || reservation.totalCents === null}
      <span class="hint">{t('catalog.price_pending')}</span>
    {:else}
      <span class="hint"
        >{t('reservation.unit_price', { price: reservation.unitPriceCents, unit })}</span
      >
      <span class="total">{t('reservation.total', { total: reservation.totalCents })}</span>
    {/if}
  </div>
  <p class="counterpart">
    {reservation.side === 'incoming'
      ? t('reservation.requester', { name: reservation.counterpart.displayName })
      : t('reservation.producer', { name: reservation.counterpart.displayName })}
  </p>
  <div class="dates hint">
    {#if detail}<span>{t('reservation.created_at', { when: reservation.createdAt })}</span>{/if}
    {#if reservation.status === 'pending' && reservation.expiresAt}
      <span>{t('reservation.expires_at', { when: reservation.expiresAt })}</span>
    {/if}
    {#if reservation.confirmedAt}
      <span data-testid="confirmed-at"
        >{t('reservation.confirmed_at', { when: reservation.confirmedAt })}</span
      >
    {/if}
    {#if reservation.deliveredAt}
      <span data-testid="delivered-at"
        >{t('reservation.delivered_at', { when: reservation.deliveredAt })}</span
      >
    {:else if reservation.closedAt}
      <span>{t('reservation.closed_at', { when: reservation.closedAt })}</span>
    {/if}
  </div>
  {#if reservation.reason}<p class="reason">
      {t('reservation.reason', { reason: reservation.reason })}
    </p>{/if}
</div>

<style>
  .summary {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .headline,
  .facts,
  .dates {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: baseline;
  }
  .quantity,
  .total {
    font-weight: 600;
  }
  .hint {
    color: var(--agrobot-hint);
    font-size: 0.9rem;
  }
  p {
    margin: 0;
  }
  .reason {
    font-size: 0.9rem;
    white-space: pre-wrap;
  }
  .badge {
    font-size: 0.8rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--agrobot-bg);
    color: var(--agrobot-hint);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.1);
  }
  .badge.pending {
    color: var(--agrobot-link);
  }
  .badge.active {
    color: var(--agrobot-button);
    font-weight: 600;
  }
  .badge.done {
    color: var(--agrobot-text);
  }
  .badge.off {
    color: var(--agrobot-destructive);
  }
</style>
