<script lang="ts">
  import {
    NOTE_MAX_LENGTH,
    quantityStep,
    unitName,
    type MyOfferView,
    type ProductView,
  } from '@agrobot/shared';
  import { ApiError } from '../../api/client.js';
  import { editOffer, publishOffer } from '../../api/offers.js';
  import { language, t } from '../../i18n/index.svelte.js';
  import { checkQuantity, productLabel, todayOnFarm } from '../../offers.js';
  import { toasts } from '../../stores/toast.svelte.js';
  import { haptic } from '../../telegram.js';
  import ProductPicker from '../ProductPicker.svelte';

  /**
   * PRD US-3.1 publish and US-3.2 edit, one form. Publishing starts at the product picker
   * (search in active + my pending products, propose when missing); editing keeps the product
   * and lets the quantity go down to what is held, the date be removed, the note change. The
   * checks mirror the server's so the button is disabled rather than the request refused.
   */
  let {
    offer = null,
    onsaved,
    oncancel,
    onconflict,
  }: {
    /** The offer being edited; `null` publishes a new one. */
    offer?: MyOfferView | null;
    onsaved: (offer: MyOfferView) => void;
    oncancel: () => void;
    /** PRD US-3.1: publishing a product already offered opens that offer for editing. */
    onconflict: (offerId: string) => void;
  } = $props();

  // A form captures the offer it opened with on purpose; a new offer means a new form.
  // svelte-ignore state_referenced_locally
  let product = $state<ProductView | null>(offer?.product ?? null);
  // A number input binds a number, or `null` while empty or unparsable.
  // svelte-ignore state_referenced_locally
  let quantityValue = $state<number | null>(offer ? offer.quantity : null);
  // svelte-ignore state_referenced_locally
  let availableUntil = $state(offer?.availableUntil ?? '');
  // svelte-ignore state_referenced_locally
  let note = $state(offer?.note ?? '');
  let saving = $state(false);

  const publishing = $derived(offer === null);
  const today = todayOnFarm();
  const entered = $derived(quantityValue !== null);
  const quantity = $derived(quantityValue ?? Number.NaN);
  const quantityCheck = $derived(
    product
      ? checkQuantity(quantity, product.unitCode, { held: offer?.held ?? 0, publishing })
      : { ok: false, reason: null },
  );
  const dateValid = $derived(availableUntil === '' || availableUntil >= today);
  const noteValid = $derived(note.trim().length <= NOTE_MAX_LENGTH);
  const canSave = $derived(
    product !== null && quantityCheck.ok && dateValid && noteValid && !saving,
  );
  const unit = $derived(product ? unitName(language(), product.unitCode) : '');

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canSave || !product) return;
    saving = true;
    try {
      const date = availableUntil === '' ? null : availableUntil;
      const trimmed = note.trim() === '' ? null : note.trim();
      const response = offer
        ? await editOffer(offer.id, { quantity, availableUntil: date, note: trimmed })
        : await publishOffer({
            productId: product.id,
            quantity,
            availableUntil: date,
            note: trimmed,
          });
      haptic('success');
      onsaved(response.offer);
    } catch (error) {
      haptic('error');
      if (error instanceof ApiError && error.code === 'OFFER_ALREADY_ACTIVE') {
        const details = error.details as { offerId?: string } | undefined;
        toasts.error(error);
        if (details?.offerId) onconflict(details.offerId);
        return;
      }
      toasts.error(error);
    } finally {
      saving = false;
    }
  }
</script>

<form class="offer-form" onsubmit={save} data-testid="offer-form">
  {#if publishing && !product}
    <h2>{t('offers.pick_product')}</h2>
    <ProductPicker onpick={(picked) => (product = picked)} />
  {:else if product}
    <div class="product">
      <span class="hint">{t('offers.product')}</span>
      <strong>{productLabel(product, language())}</strong>
      <span class="hint"
        >{product.priceCents === null
          ? t('catalog.price_pending')
          : t('catalog.price', { price: product.priceCents, unit })}</span
      >
      {#if publishing}
        <button type="button" class="secondary" onclick={() => (product = null)}
          >{t('offers.change_product')}</button
        >
      {/if}
    </div>

    <label
      >{t('offers.quantity', { unit })}
      <input
        type="number"
        inputmode="decimal"
        bind:value={quantityValue}
        min={offer ? offer.held : quantityStep(product.unitCode)}
        step={quantityStep(product.unitCode)}
        required
        disabled={saving}
        aria-invalid={entered && !quantityCheck.ok}
      />
    </label>
    {#if entered && quantityCheck.reason === 'step'}
      <p class="hint error">
        {t('offers.quantity_step', { step: quantityStep(product.unitCode), unit })}
      </p>
    {:else if quantityCheck.reason === 'below_held' && offer}
      <p class="hint error">{t('offers.quantity_below_held', { held: offer.held, unit })}</p>
    {:else if entered && quantityCheck.reason === 'zero'}
      <p class="hint error">{t('offers.quantity_zero')}</p>
    {:else}
      <p class="hint">
        {t('offers.quantity_hint', { step: quantityStep(product.unitCode), unit })}
      </p>
    {/if}

    <label
      >{t('offers.available_until')}
      <input
        type="date"
        bind:value={availableUntil}
        min={today}
        disabled={saving}
        aria-invalid={!dateValid}
      />
    </label>
    {#if !dateValid}<p class="hint error">{t('offers.date_past')}</p>{/if}

    <label
      >{t('offers.note')}
      <textarea bind:value={note} maxlength={NOTE_MAX_LENGTH} rows="2" disabled={saving}></textarea>
    </label>
    <p class="hint">
      {t('offers.note_hint', { max: NOTE_MAX_LENGTH, length: note.trim().length })}
    </p>
  {/if}

  <div class="actions">
    {#if product}
      <button type="submit" disabled={!canSave}
        >{t(publishing ? 'offers.publish' : 'common.save')}</button
      >
    {/if}
    <button type="button" class="secondary" disabled={saving} onclick={oncancel}
      >{t('common.cancel')}</button
    >
  </div>
</form>

<style>
  .offer-form,
  .product,
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .product {
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
    gap: 4px;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
    font-size: 0.85rem;
  }
  .error {
    color: var(--agrobot-destructive);
  }
  input,
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
  input[aria-invalid='true'] {
    border-color: var(--agrobot-destructive);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
