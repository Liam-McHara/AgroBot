<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import {
    REASON_MAX_LENGTH,
    type ReservationAction,
    type ReservationDetailView,
  } from '@agrobot/shared';
  import { ApiError } from '../lib/api/client.js';
  import { actOnReservation, fetchReservation } from '../lib/api/reservations.js';
  import ReservationSummary from '../lib/components/reservations/ReservationSummary.svelte';
  import Screen from '../lib/components/Screen.svelte';
  import { t } from '../lib/i18n/index.svelte.js';
  import { ACTIONS_WITH_REASON } from '../lib/reservations.js';
  import { realtime } from '../lib/stores/realtime.svelte.js';
  import { toasts } from '../lib/stores/toast.svelte.js';
  import { haptic } from '../lib/telegram.js';

  /**
   * ARCH §12 `/reservations/:id`, the target of the `r_<id>` deep link (ARCH §4): the
   * reservation with its context and the actions ARCH §6 allows me right now, straight from
   * the API so the screen never guesses at the state machine. Confirm is one tap; the closing
   * actions ask once, and reject/cancel take an optional reason (PRD US-4.2, US-4.3).
   * *Confirm and mark delivered* is the producer's one-tap handover (ADR-0014). M5 puts the
   * thread under this header.
   */
  let { params }: { params: { id: string } } = $props();

  let reservation = $state<ReservationDetailView | null>(null);
  let loading = $state(true);
  let missing = $state(false);
  let busy = $state(false);
  /** Every action but a plain confirm asks once; this is the one awaiting the answer. */
  type ConfirmableAction = Exclude<ReservationAction, 'confirm'>;
  let pending = $state<ConfirmableAction | null>(null);
  let reason = $state('');

  async function load(): Promise<void> {
    try {
      reservation = (await fetchReservation(params.id)).reservation;
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
    const unsubscribe = [
      realtime.on('reservation.changed', (event) => {
        if (event.type === 'reservation.changed' && event.id === params.id) void load();
      }),
      realtime.onReconnect(() => void load()),
    ];
    return () => {
      for (const off of unsubscribe) off();
    };
  });

  const takesReason = (action: ReservationAction) =>
    (ACTIONS_WITH_REASON as readonly string[]).includes(action);

  function start(action: ReservationAction): void {
    if (action === 'confirm') {
      void run(action);
    } else {
      pending = action;
      reason = '';
    }
  }

  async function run(action: ReservationAction): Promise<void> {
    if (!reservation) return;
    busy = true;
    try {
      const trimmed = reason.trim();
      const body = takesReason(action) && trimmed !== '' ? { reason: trimmed } : {};
      reservation = (await actOnReservation(reservation.id, action, body)).reservation;
      pending = null;
      haptic('success');
      toasts.success(t(`reservation.done.${action}`));
    } catch (error) {
      haptic('error');
      toasts.error(error);
      // A stale screen: someone else moved it meanwhile; show where it stands now.
      if (error instanceof ApiError && error.code === 'INVALID_TRANSITION') void load();
    } finally {
      busy = false;
    }
  }
</script>

<Screen title={t('reservation.title')}>
  {#if loading}
    <p class="hint" role="status">{t('common.loading')}</p>
  {:else if missing || !reservation}
    <p class="hint">{t('reservation.not_found')}</p>
    <button type="button" class="secondary" onclick={() => void push('/reservations')}
      >{t('nav.reservations')}</button
    >
  {:else}
    <div class="card" data-testid="reservation-detail" data-status={reservation.status}>
      <ReservationSummary {reservation} detail />
      {#if reservation.offer.note}
        <p class="hint">{t('reservation.offer_note', { note: reservation.offer.note })}</p>
      {/if}
      {#if reservation.offer.status !== 'active' && (reservation.status === 'pending' || reservation.status === 'confirmed')}
        <p class="hint">{t(`reservation.offer_gone.${reservation.offer.status}`)}</p>
      {/if}
    </div>

    {#if pending}
      <div class="confirm" data-testid="action-confirm">
        <p>{t(`reservation.confirm.${pending}`)}</p>
        {#if takesReason(pending)}
          <label
            >{t('reservation.reason_label')}
            <textarea bind:value={reason} maxlength={REASON_MAX_LENGTH} rows="2" disabled={busy}
            ></textarea>
          </label>
        {/if}
        <div class="actions">
          <button
            type="button"
            class={pending === 'deliver' || pending === 'confirm-and-deliver' ? '' : 'danger'}
            disabled={busy}
            onclick={() => pending && run(pending)}>{t(`reservation.action.${pending}`)}</button
          >
          <button type="button" class="secondary" disabled={busy} onclick={() => (pending = null)}
            >{t('common.cancel')}</button
          >
        </div>
      </div>
    {:else if reservation.actions.length > 0}
      <div class="actions" data-testid="reservation-actions">
        {#each reservation.actions as action (action)}
          <button
            type="button"
            class={action === 'reject' || action === 'cancel' ? 'danger' : ''}
            disabled={busy}
            onclick={() => start(action)}>{t(`reservation.action.${action}`)}</button
          >
        {/each}
        {#if reservation.actions.includes('confirm-and-deliver')}
          <p class="hint">{t('reservation.action.confirm-and-deliver_hint')}</p>
        {/if}
      </div>
    {/if}

    <p class="hint">{t('reservation.chat_soon')}</p>
  {/if}
</Screen>

<style>
  .card,
  .confirm,
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card,
  .confirm {
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions .hint {
    flex-basis: 100%;
  }
  textarea {
    min-height: var(--agrobot-touch-target);
    width: 100%;
    padding: 10px;
    font: inherit;
    border: 1px solid var(--agrobot-hint);
    border-radius: var(--agrobot-radius);
    color: var(--agrobot-text);
    background: var(--agrobot-bg);
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--agrobot-hint);
    font-size: 0.9rem;
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
