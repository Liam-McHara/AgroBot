<script lang="ts">
  import { onMount } from 'svelte';
  import Router, { push, router } from 'svelte-spa-router';
  import BottomNav from './lib/components/BottomNav.svelte';
  import Toast from './lib/components/Toast.svelte';
  import { t } from './lib/i18n/index.svelte.js';
  import { meStore } from './lib/stores/me.svelte.js';
  import { realtime } from './lib/stores/realtime.svelte.js';
  import { initTelegram, routeForStartParam, syncBackButton } from './lib/telegram.js';
  import Board from './routes/Board.svelte';
  import Gate from './routes/Gate.svelte';
  import OfferDetail from './routes/OfferDetail.svelte';
  import Offers from './routes/Offers.svelte';
  import ReservationDetail from './routes/ReservationDetail.svelte';
  import Reservations from './routes/Reservations.svelte';
  import Settings from './routes/Settings.svelte';
  import AdminCatalog from './routes/admin/Catalog.svelte';
  import AdminMembers from './routes/admin/Members.svelte';
  import AdminSettings from './routes/admin/Settings.svelte';

  /**
   * ARCH §12: everything redirects to the gate while the member is not approved; approved
   * members get the routed screens with the bottom navigation. Admin routes are only mounted
   * for admins, so a member typing the URL lands on the board.
   */
  const routes = $derived({
    '/': Board,
    '/offers': Offers,
    '/offers/:id': OfferDetail,
    '/reservations': Reservations,
    '/reservations/:id': ReservationDetail,
    '/settings': Settings,
    ...(meStore.isAdmin
      ? {
          '/admin/members': AdminMembers,
          '/admin/catalog': AdminCatalog,
          '/admin/settings': AdminSettings,
        }
      : {}),
    '*': Board,
  });

  onMount(() => {
    void meStore.refetch().then(() => {
      const target = routeForStartParam(initTelegram().startParam);
      if (target && meStore.isApproved) void push(target);
    });
    // ARCH §7: `me.changed` refetches the profile — an approval, a role change, a new
    // language chosen in another tab — `message.new` refreshes the unread badge (PRD US-4.6),
    // and a reconnect refetches everything we hold.
    const unsubscribe = [
      realtime.on('me.changed', () => void meStore.refetch()),
      realtime.on('message.new', () => void meStore.refetch()),
      realtime.onReconnect(() => void meStore.refetch()),
    ];
    return () => {
      for (const off of unsubscribe) off();
      realtime.stop();
    };
  });

  // The socket needs an identity, so it opens once `/me` has answered, whatever it said:
  // applicants wait at the gate for `me.changed` instead of polling (ADR-0016).
  $effect(() => {
    if (meStore.me) realtime.start();
  });

  $effect(() => {
    syncBackButton(router.location);
  });
</script>

{#if meStore.me === null}
  <main class="centered">
    {#if meStore.loading}
      <p class="hint">{t('common.loading')}</p>
    {:else if meStore.error}
      <p class="error">{t('miniapp.error.load_failed')}</p>
      <p class="hint">{meStore.error.message}</p>
      <button type="button" onclick={() => meStore.refetch()}>{t('common.retry')}</button>
    {/if}
  </main>
{:else if meStore.me.status !== 'approved'}
  <Gate status={meStore.me.status} />
{:else}
  <Router {routes} />
  <BottomNav />
{/if}
<Toast />

<style>
  .centered {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--agrobot-space);
    padding: var(--agrobot-space);
    text-align: center;
  }

  p {
    margin: 0;
  }

  .hint {
    color: var(--agrobot-hint);
  }

  .error {
    color: var(--agrobot-destructive);
  }
</style>
