<script lang="ts">
  import { onMount } from 'svelte';
  import {
    PRODUCT_STATUSES,
    productNameSchema,
    unitName,
    type AdminCatalog,
    type ProductStatus,
    type ProductView,
  } from '@agrobot/shared';
  import Screen from '../../lib/components/Screen.svelte';
  import AdminNav from '../../lib/components/AdminNav.svelte';
  import {
    fetchCatalog,
    syncCatalog,
    renameProduct,
    rejectProduct,
  } from '../../lib/api/catalog.js';
  import { language, t } from '../../lib/i18n/index.svelte.js';
  import { toasts } from '../../lib/stores/toast.svelte.js';
  import { haptic } from '../../lib/telegram.js';

  const statuses = ['all', ...PRODUCT_STATUSES] as const;
  let data = $state<AdminCatalog | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let syncing = $state(false);
  let filter = $state<ProductStatus | 'all'>('all');
  let editing = $state<string | null>(null);
  let newName = $state('');
  let rejecting = $state<string | null>(null);
  const lastSync = $derived(data?.syncs[0]);
  const visible = $derived(
    data?.products.filter((p) => filter === 'all' || p.status === filter) ?? [],
  );

  async function load() {
    loading = true;
    try {
      data = await fetchCatalog();
    } catch (error) {
      toasts.error(error);
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    void load();
  });
  async function sync() {
    busy = true;
    syncing = true;
    try {
      const result = await syncCatalog();
      if (data) data = { ...data, syncs: [result.sync, ...data.syncs].slice(0, 10) };
      await load();
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
      syncing = false;
    }
  }
  async function act(product: ProductView, action: 'rename' | 'reject') {
    busy = true;
    try {
      if (action === 'rename') await renameProduct(product.id, newName.trim());
      else await rejectProduct(product.id);
      editing = null;
      rejecting = null;
      haptic('success');
      await load();
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }
  async function copy(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      toasts.success(t('catalog.copied'));
    } catch {
      toasts.show('error', t('catalog.copy_failed'));
    }
  }
</script>

<Screen title={t('catalog.title')}>
  <AdminNav />
  <div class="actions">
    <button type="button" disabled={busy || loading} onclick={sync}
      >{t(syncing ? 'catalog.syncing' : 'catalog.sync')}</button
    >
    {#if data}<a href={data.sheetUrl} target="_blank" rel="noreferrer">{t('catalog.sheet')}</a>{/if}
  </div>
  {#if loading && !data}
    <p role="status">{t('common.loading')}</p>
  {:else if !data}
    <button type="button" onclick={load}>{t('common.retry')}</button>
  {:else}
    <section class="report" aria-live="polite">
      {#if lastSync}
        <strong>{t(`catalog.sync.${lastSync.status}`)}</strong>
        <p>{t('catalog.last_sync', { when: lastSync.startedAt })}</p>
        <p>
          {t('catalog.sync.summary', {
            rows: lastSync.rowsRead,
            created: lastSync.created,
            updated: lastSync.updated,
            archived: lastSync.archived,
            resolved: lastSync.resolvedPending,
          })}
        </p>
        {#if lastSync.errors.length}
          <table>
            <thead><tr><th>{t('catalog.row')}</th><th>{t('catalog.reason')}</th></tr></thead>
            <tbody>
              {#each lastSync.errors as issue, index (`${issue.row}-${issue.reason}-${index}`)}
                <tr
                  ><td>{issue.row || t('catalog.source')}</td><td
                    >{#if issue.severity === 'warning'}{t('catalog.warning')}:
                    {/if}{t(`catalog.issue.${issue.reason}`)}</td
                  ></tr
                >
              {/each}
            </tbody>
          </table>
        {/if}
      {:else}<p>{t('catalog.never_synced')}</p>{/if}
    </section>
    <p class="hint">{t('catalog.counts', data.counts)}</p>
    <label
      >{t('catalog.filter')}
      <select bind:value={filter}>
        {#each statuses as status (status)}<option value={status}
            >{t(`catalog.status.${status}`)}</option
          >{/each}
      </select>
    </label>
    {#if visible.length === 0}<p class="hint">{t('catalog.empty')}</p>{/if}
    <ul>
      {#each visible as product (product.id)}
        <li data-testid="catalog-product">
          <strong>{language() === 'es' ? product.nameEs || product.name : product.name}</strong>
          <span class="hint"
            >{t(`catalog.status.${product.status}`)} · {product.priceCents === null
              ? t('catalog.price_pending')
              : t('catalog.price', {
                  price: product.priceCents,
                  unit: unitName(language(), product.unitCode),
                })}</span
          >
          {#if product.status === 'pending'}
            <span class="exact-name">{product.name}</span>
            <div class="actions">
              <button type="button" class="secondary" onclick={() => copy(product.name)}
                >{t('catalog.copy')}</button
              >
              <button
                type="button"
                disabled={busy}
                onclick={() => {
                  editing = product.id;
                  newName = product.name;
                  rejecting = null;
                }}>{t('catalog.rename')}</button
              >
              <button
                type="button"
                class="danger"
                disabled={busy}
                onclick={() => {
                  rejecting = product.id;
                  editing = null;
                }}>{t('catalog.reject')}</button
              >
            </div>
            {#if editing === product.id}
              <form
                onsubmit={(event) => {
                  event.preventDefault();
                  void act(product, 'rename');
                }}
              >
                <label
                  >{t('catalog.name')}<input
                    bind:value={newName}
                    minlength="2"
                    maxlength="60"
                    required
                    disabled={busy}
                  /></label
                >
                <div class="actions">
                  <button
                    type="submit"
                    disabled={busy || !productNameSchema.safeParse(newName).success}
                    >{t('common.save')}</button
                  >
                  <button
                    type="button"
                    class="secondary"
                    disabled={busy}
                    onclick={() => (editing = null)}>{t('common.cancel')}</button
                  >
                </div>
              </form>
            {/if}
            {#if rejecting === product.id}
              <p>{t('catalog.reject_confirm', { name: product.name })}</p>
              <div class="actions">
                <button
                  type="button"
                  class="danger"
                  disabled={busy}
                  onclick={() => act(product, 'reject')}>{t('catalog.reject')}</button
                >
                <button
                  type="button"
                  class="secondary"
                  disabled={busy}
                  onclick={() => (rejecting = null)}>{t('common.cancel')}</button
                >
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Screen>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  a {
    min-height: var(--agrobot-touch-target);
    display: flex;
    align-items: center;
    color: var(--agrobot-link);
  }
  .report,
  li {
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
    overflow-wrap: anywhere;
  }
  p {
    margin: 8px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td,
  th {
    text-align: left;
    padding: 8px 4px;
    vertical-align: top;
    border-bottom: 1px solid var(--agrobot-hint);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  li,
  label,
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hint {
    color: var(--agrobot-hint);
  }
  .exact-name {
    user-select: all;
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
