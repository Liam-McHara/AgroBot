<script lang="ts">
  import { push } from 'svelte-spa-router';
  import type { OfferView } from '@agrobot/shared';
  import { t } from '../../i18n/index.svelte.js';
  import ReserveForm from '../reservations/ReserveForm.svelte';
  import OfferSummary from './OfferSummary.svelte';

  /**
   * ARCH §12 `/`: the offer detail sheet with the reserve form (PRD US-4.1). A successful
   * reservation lands on its own screen, where the thread will open in M5.
   */
  let { offer, onclose }: { offer: OfferView; onclose: () => void } = $props();
</script>

<button type="button" class="backdrop" aria-label={t('common.close')} onclick={onclose}></button>
<div class="sheet" role="dialog" aria-modal="true" aria-label={t('board.offer')}>
  <OfferSummary {offer} />
  <ReserveForm
    {offer}
    onreserved={(reservation) => {
      onclose();
      void push(`/reservations/${reservation.id}`);
    }}
  />
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
</style>
