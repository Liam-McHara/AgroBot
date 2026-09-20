<script lang="ts">
  import {
    insufficientAvailabilityDetailsSchema,
    quantityStep,
    totalCents,
    unitName,
    type OfferView,
    type ReservationDetailView,
  } from '@agrobot/shared';
  import { ApiError } from '../../api/client.js';
  import { createReservation } from '../../api/reservations.js';
  import { language, t } from '../../i18n/index.svelte.js';
  import { checkReserveQuantity } from '../../reservations.js';
  import { toasts } from '../../stores/toast.svelte.js';
  import { haptic } from '../../telegram.js';

  /**
   * PRD US-4.1: the reserve form of the offer detail — a quantity on the unit's step, up to
   * what is available, with the total previewed (or *price pending*). When someone else got
   * there first the API answers with what is left (409 `INSUFFICIENT_AVAILABILITY`) and the
   * form offers to reserve exactly that instead.
   */
  let {
    offer,
    onreserved,
  }: { offer: OfferView; onreserved: (reservation: ReservationDetailView) => void } = $props();

  // A number input binds a number, or `null` while empty or unparsable.
  let quantityValue = $state<number | null>(null);
  let saving = $state(false);
  /** What the server said is left after a refused attempt; `null` while nothing was refused. */
  let conflict = $state<number | null>(null);

  const unit = $derived(unitName(language(), offer.product.unitCode));
  const step = $derived(quantityStep(offer.product.unitCode));
  const check = $derived(
    checkReserveQuantity(quantityValue, offer.product.unitCode, offer.available),
  );
  const total = $derived(
    quantityValue !== null && check.ok ? totalCents(quantityValue, offer.product.priceCents) : null,
  );

  async function reserve(quantity: number): Promise<void> {
    saving = true;
    conflict = null;
    try {
      const response = await createReservation({ offerId: offer.id, quantity });
      haptic('success');
      toasts.success(t('reserve.done'));
      onreserved(response.reservation);
    } catch (error) {
      haptic('error');
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_AVAILABILITY') {
        const details = insufficientAvailabilityDetailsSchema.safeParse(error.details);
        conflict = details.success ? details.data.available : 0;
        return;
      }
      toasts.error(error);
    } finally {
      saving = false;
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!check.ok || quantityValue === null) return;
    void reserve(quantityValue);
  }

  function takeWhatIsLeft(): void {
    if (conflict === null || conflict <= 0) return;
    const available = conflict;
    quantityValue = available;
    void reserve(available);
  }
</script>

<form class="reserve" onsubmit={submit} data-testid="reserve-form">
  <label
    >{t('reserve.quantity', { unit })}
    <input
      type="number"
      inputmode="decimal"
      bind:value={quantityValue}
      min={step}
      max={offer.available}
      {step}
      required
      disabled={saving}
      aria-invalid={quantityValue !== null && !check.ok}
    />
  </label>
  {#if check.reason === 'step'}
    <p class="hint error">{t('offers.quantity_step', { step, unit })}</p>
  {:else if check.reason === 'zero'}
    <p class="hint error">{t('offers.quantity_zero')}</p>
  {:else if check.reason === 'over'}
    <p class="hint error">{t('reserve.over', { available: offer.available, unit })}</p>
  {:else}
    <p class="hint">{t('reserve.available', { quantity: offer.available, unit })}</p>
  {/if}
  {#if offer.product.priceCents === null}
    <p class="hint">{t('reserve.total_pending')}</p>
  {:else if total !== null}
    <p class="total" data-testid="reserve-total">{t('reserve.total', { total })}</p>
  {/if}

  {#if conflict !== null}
    <div class="conflict" role="alert" data-testid="reserve-conflict">
      {#if conflict > 0}
        <p>{t('reserve.conflict', { available: conflict, unit })}</p>
        <button type="button" disabled={saving} onclick={takeWhatIsLeft}
          >{t('reserve.conflict_accept', { available: conflict, unit })}</button
        >
      {:else}
        <p>{t('reserve.conflict_none')}</p>
      {/if}
    </div>
  {/if}

  <button type="submit" data-testid="reserve" disabled={!check.ok || saving}
    >{t('board.reserve')}</button
  >
</form>

<style>
  .reserve,
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  input {
    min-height: var(--agrobot-touch-target);
    width: 100%;
    padding: 10px;
    font: inherit;
    border: 1px solid var(--agrobot-hint);
    border-radius: var(--agrobot-radius);
    color: var(--agrobot-text);
    background: var(--agrobot-bg);
  }
  input[aria-invalid='true'] {
    border-color: var(--agrobot-destructive);
  }
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
    font-size: 0.85rem;
  }
  .error {
    color: var(--agrobot-destructive);
  }
  .total {
    margin: 0;
    font-weight: 600;
  }
  .conflict {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-secondary-bg);
  }
  .conflict p {
    margin: 0;
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
