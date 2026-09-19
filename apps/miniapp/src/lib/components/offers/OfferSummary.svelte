<script lang="ts">
  import { unitName, type OfferView } from '@agrobot/shared';
  import { language, t } from '../../i18n/index.svelte.js';
  import { productLabel } from '../../offers.js';

  /**
   * PRD US-3.3: one offer as any member sees it — product, what is available, the price per
   * unit (or *price pending*), who offers it, until when, the note and the stale marker.
   */
  let {
    offer,
    showProduct = true,
    showProducer = true,
  }: { offer: OfferView; showProduct?: boolean; showProducer?: boolean } = $props();

  const unit = $derived(unitName(language(), offer.product.unitCode));
</script>

<div class="summary" data-testid="offer" data-offer-id={offer.id}>
  <div class="headline">
    {#if showProduct}<strong class="product">{productLabel(offer.product, language())}</strong>{/if}
    {#if showProducer}<span class="producer">{offer.producer.displayName}</span>{/if}
  </div>
  <div class="facts">
    <span class="available">{t('offer.available', { quantity: offer.available, unit })}</span>
    <span class="price"
      >{offer.product.priceCents === null
        ? t('catalog.price_pending')
        : t('catalog.price', { price: offer.product.priceCents, unit })}</span
    >
  </div>
  {#if offer.availableUntil || offer.stale}
    <div class="badges">
      {#if offer.availableUntil}<span class="badge"
          >{t('offer.until', { date: offer.availableUntil })}</span
        >{/if}
      {#if offer.stale}<span class="badge stale">{t('offer.stale')}</span>{/if}
    </div>
  {/if}
  {#if offer.note}<p class="note">{offer.note}</p>{/if}
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
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: baseline;
  }
  .producer,
  .price {
    color: var(--agrobot-hint);
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
  .badge.stale {
    color: var(--agrobot-destructive);
  }
  .note {
    margin: 0;
    font-size: 0.9rem;
    white-space: pre-wrap;
  }
</style>
