<script lang="ts">
  import { onMount } from 'svelte';
  import { BOARD_GROUPINGS, type OfferView } from '@agrobot/shared';
  import OfferSheet from '../lib/components/offers/OfferSheet.svelte';
  import OfferSummary from '../lib/components/offers/OfferSummary.svelte';
  import Screen from '../lib/components/Screen.svelte';
  import { language, t } from '../lib/i18n/index.svelte.js';
  import { boardStore } from '../lib/stores/board.svelte.js';
  import { realtime } from '../lib/stores/realtime.svelte.js';
  import { toasts } from '../lib/stores/toast.svelte.js';

  /**
   * ARCH §12 `/`, PRD US-3.3: everything I can reserve right now, from the other members —
   * search, group by product or producer, category chips, and a detail sheet per offer. It
   * refreshes live on `board.changed` (ARCH §7) and on demand with the refresh button, the
   * pull-to-refresh fallback of a web view.
   */
  let search = $state(boardStore.params.q);
  let selected = $state<OfferView | null>(null);

  onMount(() => {
    void boardStore.refetch();
    const unsubscribe = [
      realtime.on('board.changed', () => void boardStore.refetch()),
      realtime.onReconnect(() => void boardStore.refetch()),
    ];
    return () => {
      for (const off of unsubscribe) off();
    };
  });

  // Typing waits for a pause before asking; the store drops answers to older filters.
  $effect(() => {
    const q = search.trim();
    if (q === boardStore.params.q) return;
    const timer = setTimeout(() => void boardStore.setQuery(q), 200);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (boardStore.error) toasts.error(boardStore.error);
  });

  const data = $derived(boardStore.data);
  const groupName = (group: { name: string; nameEs: string | null }) =>
    language() === 'es' ? group.nameEs || group.name : group.name;
</script>

<Screen title={t('nav.board')}>
  <div class="toolbar">
    <label class="search"
      >{t('board.search')}
      <input type="search" bind:value={search} maxlength="100" />
    </label>
    <button
      type="button"
      class="secondary refresh"
      aria-label={t('common.refresh')}
      onclick={() => void boardStore.refetch()}>↻</button
    >
  </div>
  <div class="segmented" role="radiogroup" aria-label={t('board.group_by')}>
    {#each BOARD_GROUPINGS as grouping (grouping)}
      <button
        type="button"
        role="radio"
        aria-checked={boardStore.params.group === grouping}
        class:selected={boardStore.params.group === grouping}
        onclick={() => void boardStore.setGroup(grouping)}>{t(`board.group.${grouping}`)}</button
      >
    {/each}
  </div>
  {#if data && data.categories.length > 0}
    <div class="chips" role="group" aria-label={t('board.category')}>
      {#each data.categories as category (category)}
        <button
          type="button"
          class="chip"
          aria-pressed={boardStore.params.category === category}
          class:selected={boardStore.params.category === category}
          onclick={() => void boardStore.toggleCategory(category)}>{category}</button
        >
      {/each}
    </div>
  {/if}

  {#if boardStore.loading && !data}
    <p class="hint" role="status">{t('common.loading')}</p>
  {:else if !data}
    <button type="button" onclick={() => void boardStore.refetch()}>{t('common.retry')}</button>
  {:else if data.total === 0}
    <p class="hint" data-testid="board-empty">
      {t(boardStore.params.q || boardStore.params.category ? 'board.empty_search' : 'board.empty')}
    </p>
  {:else}
    {#each data.groups as group (group.key)}
      <section class="group" data-testid="board-group">
        <h2>{groupName(group)}</h2>
        <ul>
          {#each group.offers as offer (offer.id)}
            <li>
              <button type="button" class="row" onclick={() => (selected = offer)}>
                <OfferSummary
                  {offer}
                  showProduct={data.group !== 'product'}
                  showProducer={data.group !== 'producer'}
                />
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</Screen>

{#if selected}
  <OfferSheet offer={selected} onclose={() => (selected = null)} />
{/if}

<style>
  .toolbar {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .search {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .refresh {
    width: var(--agrobot-touch-target);
    padding: 0;
    font-size: 1.2rem;
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
  .segmented {
    display: flex;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
    padding: 4px;
    gap: 4px;
  }
  .segmented button {
    flex: 1;
    background: transparent;
    color: var(--agrobot-text);
  }
  .segmented button.selected {
    background: var(--agrobot-button);
    color: var(--agrobot-button-text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
  }
  .chip.selected {
    background: var(--agrobot-button);
    color: var(--agrobot-button-text);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .row {
    display: block;
    width: 100%;
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
    text-align: left;
  }
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
  }
</style>
