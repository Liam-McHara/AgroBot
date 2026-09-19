<script lang="ts">
  import { onMount } from 'svelte';
  import type { MyOfferView } from '@agrobot/shared';
  import { confirmStillAvailable, fetchMyOffers, withdrawOffer } from '../lib/api/offers.js';
  import MyOfferCard from '../lib/components/offers/MyOfferCard.svelte';
  import OfferForm from '../lib/components/offers/OfferForm.svelte';
  import Screen from '../lib/components/Screen.svelte';
  import { language, t } from '../lib/i18n/index.svelte.js';
  import { productLabel } from '../lib/offers.js';
  import { realtime } from '../lib/stores/realtime.svelte.js';
  import { toasts } from '../lib/stores/toast.svelte.js';
  import { haptic } from '../lib/telegram.js';

  /**
   * ARCH §12 `/offers`, PRD US-3.1, US-3.2, US-3.4: my offers with held and available, the
   * publish form behind the product picker, edit, withdraw (with the reminder that open
   * reservations stay valid) and *Yes, still available*. Held and available move when others
   * reserve and when the jobs run, so the list refetches on `board.changed` too (ARCH §7).
   */
  type Mode = { kind: 'list' } | { kind: 'publish' } | { kind: 'edit'; offer: MyOfferView };

  let offers = $state<MyOfferView[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  let busy = $state<string | null>(null);
  let mode = $state<Mode>({ kind: 'list' });
  let withdrawing = $state<MyOfferView | null>(null);

  async function load(): Promise<void> {
    try {
      offers = (await fetchMyOffers()).offers;
      failed = false;
    } catch (error) {
      failed = true;
      toasts.error(error);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    const unsubscribe = [
      realtime.on('board.changed', () => void load()),
      realtime.onReconnect(() => void load()),
    ];
    return () => {
      for (const off of unsubscribe) off();
    };
  });

  function replace(offer: MyOfferView): void {
    const index = offers.findIndex((o) => o.id === offer.id);
    offers =
      offer.status === 'withdrawn'
        ? offers.filter((o) => o.id !== offer.id)
        : index === -1
          ? [offer, ...offers]
          : offers.map((o) => (o.id === offer.id ? offer : o));
  }

  function saved(offer: MyOfferView): void {
    const published = mode.kind === 'publish';
    replace(offer);
    mode = { kind: 'list' };
    toasts.success(t(published ? 'offers.published' : 'common.saved'));
  }

  /** PRD US-3.1: the product already has an active offer of mine — edit that one. */
  function conflict(offerId: string): void {
    const existing = offers.find((o) => o.id === offerId);
    if (existing) mode = { kind: 'edit', offer: existing };
  }

  async function withdraw(offer: MyOfferView): Promise<void> {
    busy = offer.id;
    try {
      replace((await withdrawOffer(offer.id)).offer);
      withdrawing = null;
      haptic('success');
      toasts.success(t('offers.withdrawn'));
    } catch (error) {
      haptic('error');
      toasts.error(error);
    } finally {
      busy = null;
    }
  }

  async function stillAvailable(offer: MyOfferView): Promise<void> {
    busy = offer.id;
    try {
      replace((await confirmStillAvailable(offer.id)).offer);
      haptic('success');
      toasts.success(t('offers.still_confirmed'));
    } catch (error) {
      haptic('error');
      toasts.error(error);
    } finally {
      busy = null;
    }
  }
</script>

<Screen title={t('nav.offers')}>
  {#if mode.kind === 'publish'}
    <OfferForm onsaved={saved} oncancel={() => (mode = { kind: 'list' })} onconflict={conflict} />
  {:else if mode.kind === 'edit'}
    {#key mode.offer.id}
      <OfferForm
        offer={mode.offer}
        onsaved={saved}
        oncancel={() => (mode = { kind: 'list' })}
        onconflict={conflict}
      />
    {/key}
  {:else}
    <button type="button" data-testid="publish" onclick={() => (mode = { kind: 'publish' })}
      >{t('offers.publish')}</button
    >
    {#if loading}
      <p class="hint" role="status">{t('common.loading')}</p>
    {:else if failed && offers.length === 0}
      <button type="button" class="secondary" onclick={load}>{t('common.retry')}</button>
    {:else if offers.length === 0}
      <p class="hint" data-testid="offers-empty">{t('offers.empty')}</p>
    {:else}
      <ul>
        {#each offers as offer (offer.id)}
          {#if withdrawing?.id === offer.id}
            <li class="confirm" data-testid="withdraw-confirm">
              <p>
                {t('offers.withdraw_confirm', {
                  product: productLabel(offer.product, language()),
                })}
              </p>
              {#if offer.openReservations > 0}
                <p class="hint">
                  {t('offers.withdraw_open_reservations', { count: offer.openReservations })}
                </p>
              {/if}
              <div class="actions">
                <button
                  type="button"
                  class="danger"
                  disabled={busy !== null}
                  onclick={() => withdraw(offer)}>{t('offers.withdraw')}</button
                >
                <button
                  type="button"
                  class="secondary"
                  disabled={busy !== null}
                  onclick={() => (withdrawing = null)}>{t('common.cancel')}</button
                >
              </div>
            </li>
          {:else}
            <MyOfferCard
              {offer}
              busy={busy !== null}
              onedit={(o) => (mode = { kind: 'edit', offer: o })}
              onwithdraw={(o) => (withdrawing = o)}
              onstill={stillAvailable}
            />
          {/if}
        {/each}
      </ul>
    {/if}
  {/if}
</Screen>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
  }
  .confirm p {
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
