<script lang="ts">
  import { unitName, type MyOfferView } from '@agrobot/shared';
  import { language, t } from '../../i18n/index.svelte.js';
  import { myOfferState, productLabel } from '../../offers.js';

  /**
   * PRD US-3.2, US-3.4: the producer's row — totals, what is held and what is left, the state
   * that needs attention (fully reserved, expired, stale, asked "still available?") and the
   * actions: edit, withdraw, and *Yes, still available* while the nudge stands.
   */
  let {
    offer,
    busy = false,
    onedit,
    onwithdraw,
    onstill,
  }: {
    offer: MyOfferView;
    busy?: boolean;
    onedit: (offer: MyOfferView) => void;
    onwithdraw: (offer: MyOfferView) => void;
    onstill: (offer: MyOfferView) => void;
  } = $props();

  const unit = $derived(unitName(language(), offer.product.unitCode));
  const state = $derived(myOfferState(offer));
</script>

<li class="card" data-testid="my-offer" data-offer-id={offer.id} data-state={state}>
  <div class="headline">
    <strong>{productLabel(offer.product, language())}</strong>
    {#if state !== 'active'}<span class="badge {state}">{t(`offer.state.${state}`)}</span>{/if}
  </div>
  <div class="facts">
    <span>{t('offer.total', { quantity: offer.quantity, unit })}</span>
    {#if offer.held > 0}<span>{t('offer.held', { quantity: offer.held, unit })}</span>{/if}
    <span class="available">{t('offer.available', { quantity: offer.available, unit })}</span>
  </div>
  <div class="facts hint">
    <span
      >{offer.product.priceCents === null
        ? t('catalog.price_pending')
        : t('catalog.price', { price: offer.product.priceCents, unit })}</span
    >
    <span
      >{offer.availableUntil
        ? t('offer.until', { date: offer.availableUntil })
        : t('offer.no_date')}</span
    >
  </div>
  {#if offer.note}<p class="note">{offer.note}</p>{/if}
  <div class="actions">
    {#if offer.nudgedAt !== null && offer.status === 'active'}
      <button type="button" disabled={busy} onclick={() => onstill(offer)}
        >{t('offers.still_available')}</button
      >
    {/if}
    <button type="button" class="secondary" disabled={busy} onclick={() => onedit(offer)}
      >{t('offers.edit')}</button
    >
    <button type="button" class="danger" disabled={busy} onclick={() => onwithdraw(offer)}
      >{t('offers.withdraw')}</button
    >
  </div>
</li>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
    overflow-wrap: anywhere;
  }
  .headline,
  .facts,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: center;
  }
  .actions {
    gap: 8px;
    margin-top: 4px;
  }
  .hint {
    color: var(--agrobot-hint);
    font-size: 0.9rem;
  }
  .available {
    font-weight: 600;
  }
  .badge {
    font-size: 0.8rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--agrobot-bg);
    color: var(--agrobot-hint);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.1);
  }
  .badge.stale,
  .badge.expired,
  .badge.withdrawn {
    color: var(--agrobot-destructive);
  }
  .badge.nudged,
  .badge.fully_reserved {
    color: var(--agrobot-link);
  }
  .note {
    margin: 0;
    font-size: 0.9rem;
    white-space: pre-wrap;
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
