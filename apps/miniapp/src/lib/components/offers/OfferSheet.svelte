<script lang="ts">
  import type { OfferView } from '@agrobot/shared';
  import { t } from '../../i18n/index.svelte.js';
  import OfferSummary from './OfferSummary.svelte';

  /**
   * ARCH §12 `/`: the offer detail sheet with the reserve form. Reserving arrives in M4; until
   * then the button is there but disabled, so the flow reads the same on the day it opens.
   */
  let { offer, onclose }: { offer: OfferView; onclose: () => void } = $props();
</script>

<button type="button" class="backdrop" aria-label={t('common.close')} onclick={onclose}></button>
<div class="sheet" role="dialog" aria-modal="true" aria-label={t('board.offer')}>
  <OfferSummary {offer} />
  <button type="button" disabled data-testid="reserve">{t('board.reserve')}</button>
  <p class="hint">{t('board.reserve_soon')}</p>
  <button type="button" class="secondary" onclick={onclose}>{t('common.close')}</button>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 5;
    background: rgb(0 0 0 / 0.4);
    border-radius: 0;
    min-height: 0;
    padding: 0;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: var(--agrobot-space);
    padding-bottom: calc(var(--agrobot-space) + env(safe-area-inset-bottom));
    background: var(--agrobot-bg);
    border-radius: var(--agrobot-radius) var(--agrobot-radius) 0 0;
    box-shadow: 0 -4px 24px rgb(0 0 0 / 0.2);
  }
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
    font-size: 0.85rem;
    text-align: center;
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
