<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import type { MyOfferView, OfferDetailView } from '@agrobot/shared';
  import { confirmStillAvailable, fetchOffer, withdrawOffer } from '../lib/api/offers.js';
  import MyOfferCard from '../lib/components/offers/MyOfferCard.svelte';
  import OfferForm from '../lib/components/offers/OfferForm.svelte';
  import OfferSummary from '../lib/components/offers/OfferSummary.svelte';
  import Screen from '../lib/components/Screen.svelte';
  import { t } from '../lib/i18n/index.svelte.js';
  import { isMine } from '../lib/offers.js';
  import { realtime } from '../lib/stores/realtime.svelte.js';
  import { toasts } from '../lib/stores/toast.svelte.js';
  import { haptic } from '../lib/telegram.js';

  /**
   * ARCH §4 deep link `o_<offerId>` → `/offers/:id`: where the *Open offer* button of N3 and
   * N10 lands. Another member sees the offer as on the board (whatever its status by now);
   * the producer sees their own card with its actions.
   */
  let { params }: { params: { id: string } } = $props();

  let offer = $state<OfferDetailView | null>(null);
  let loading = $state(true);
  let missing = $state(false);
  let editing = $state(false);
  let busy = $state(false);
  let withdrawing = $state(false);

  async function load(): Promise<void> {
    try {
      offer = (await fetchOffer(params.id)).offer;
      missing = false;
    } catch (error) {
      missing = true;
      toasts.error(error);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    const off = realtime.on('board.changed', () => void load());
    return off;
  });

  function saved(updated: MyOfferView): void {
    offer = updated;
    editing = false;
    toasts.success(t('common.saved'));
  }

  async function act(action: 'withdraw' | 'still'): Promise<void> {
    if (!offer) return;
    busy = true;
    try {
      const response =
        action === 'withdraw'
          ? await withdrawOffer(offer.id)
          : await confirmStillAvailable(offer.id);
      offer = response.offer;
      withdrawing = false;
      haptic('success');
      toasts.success(t(action === 'withdraw' ? 'offers.withdrawn' : 'offers.still_confirmed'));
    } catch (error) {
      haptic('error');
      toasts.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<Screen title={t('board.offer')}>
  {#if loading}
    <p class="hint" role="status">{t('common.loading')}</p>
  {:else if missing || !offer}
    <p class="hint">{t('offers.not_found')}</p>
    <button type="button" class="secondary" onclick={() => void push('/')}>{t('nav.board')}</button>
  {:else if isMine(offer)}
    {#if editing}
      <OfferForm {offer} onsaved={saved} oncancel={() => (editing = false)} onconflict={() => {}} />
    {:else}
      <ul>
        <MyOfferCard
          {offer}
          {busy}
          onedit={() => (editing = true)}
          onwithdraw={() => (withdrawing = true)}
          onstill={() => act('still')}
        />
      </ul>
      {#if withdrawing}
        <p>{t('offers.withdraw_confirm', { product: offer.product.name })}</p>
        <div class="actions">
          <button type="button" class="danger" disabled={busy} onclick={() => act('withdraw')}
            >{t('offers.withdraw')}</button
          >
          <button
            type="button"
            class="secondary"
            disabled={busy}
            onclick={() => (withdrawing = false)}>{t('common.cancel')}</button
          >
        </div>
      {/if}
    {/if}
  {:else}
    <div class="card">
      <OfferSummary {offer} />
      {#if offer.status !== 'active'}
        <p class="hint">{t(`offers.gone.${offer.status}`)}</p>
      {:else}
        <button type="button" disabled data-testid="reserve">{t('board.reserve')}</button>
        <p class="hint">{t('board.reserve_soon')}</p>
      {/if}
    </div>
  {/if}
</Screen>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
  }
  p {
    margin: 0;
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
