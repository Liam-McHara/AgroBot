<script lang="ts">
  import {
    productNameSchema,
    UNIT_CODES,
    unitName,
    type ProductView,
    type UnitCode,
  } from '@agrobot/shared';
  import { fetchProducts, proposeProduct } from '../api/catalog.js';
  import { language, t } from '../i18n/index.svelte.js';
  import { toasts } from '../stores/toast.svelte.js';
  import { haptic } from '../telegram.js';

  let { onpick }: { onpick?: (product: ProductView) => void } = $props();
  let query = $state('');
  let unitCode = $state<UnitCode>('kg');
  let products = $state<ProductView[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  let busy = $state(false);
  let revision = $state(0);
  let request = 0;
  const canPropose = $derived(
    !loading && !failed && products.length === 0 && productNameSchema.safeParse(query).success,
  );

  $effect(() => {
    const search = query;
    void revision;
    const current = ++request;
    loading = true;
    failed = false;
    const timer = setTimeout(() => {
      void fetchProducts(search)
        .then((response) => {
          if (current === request) products = response.products;
        })
        .catch((error: unknown) => {
          if (current === request) {
            failed = true;
            toasts.error(error);
          }
        })
        .finally(() => {
          if (current === request) loading = false;
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      request++;
    };
  });

  async function propose(event: SubmitEvent) {
    event.preventDefault();
    if (!canPropose || busy) return;
    busy = true;
    try {
      const { product } = await proposeProduct({ name: query.trim(), unitCode });
      products = [product];
      onpick?.(product);
      haptic('success');
      toasts.success(t('catalog.proposed'));
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<div class="picker">
  <label>
    {t('catalog.search')}
    <input type="search" bind:value={query} maxlength="100" disabled={busy} />
  </label>
  {#if loading}
    <p class="hint" role="status">{t('common.loading')}</p>
  {:else if failed}
    <button type="button" onclick={() => revision++}>{t('common.retry')}</button>
  {:else}
    {#if products.length === 0}<p class="hint">{t('catalog.empty')}</p>{/if}
    <ul>
      {#each products as product (product.id)}
        <li>
          <button class="product" type="button" onclick={() => onpick?.(product)}>
            <strong>{language() === 'es' ? product.nameEs || product.name : product.name}</strong>
            <span class="hint"
              >{product.priceCents === null
                ? t('catalog.price_pending')
                : t('catalog.price', {
                    price: product.priceCents,
                    unit: unitName(language(), product.unitCode),
                  })}</span
            >
          </button>
        </li>
      {/each}
    </ul>
    {#if canPropose}
      <form onsubmit={propose}>
        <label
          >{t('catalog.unit')}
          <select bind:value={unitCode} disabled={busy}>
            {#each UNIT_CODES as code (code)}<option value={code}
                >{unitName(language(), code)}</option
              >{/each}
          </select>
        </label>
        <button type="submit" disabled={busy}>{t('catalog.propose', { name: query.trim() })}</button
        >
      </form>
    {/if}
  {/if}
</div>

<style>
  .picker,
  form,
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .product {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
    text-align: left;
    padding: 12px;
  }
  .hint {
    color: var(--agrobot-hint);
    margin: 0;
  }
  input,
  select {
    min-height: var(--agrobot-touch-target);
    width: 100%;
    padding: 10px;
    font: inherit;
    border: 1px solid var(--agrobot-hint);
    border-radius: var(--agrobot-radius);
    color: var(--agrobot-text);
    background: var(--agrobot-bg);
  }
  button[disabled] {
    opacity: 0.5;
  }
</style>
