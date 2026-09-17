<script lang="ts">
  import type { ProductView } from '@agrobot/shared';
  import ProductPicker from '../lib/components/ProductPicker.svelte';
  import Screen from '../lib/components/Screen.svelte';
  import { language, t } from '../lib/i18n/index.svelte.js';

  let selected = $state<ProductView | null>(null);
</script>

<Screen title={t('nav.offers')}>
  <ProductPicker onpick={(product) => (selected = product)} />
  {#if selected}<p role="status">
      {t('catalog.selected', {
        name: language() === 'es' ? selected.nameEs || selected.name : selected.name,
      })}
    </p>{/if}
  <p class="hint" data-testid="offers-placeholder">{t('placeholder.offers')}</p>
</Screen>

<style>
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
  }
</style>
