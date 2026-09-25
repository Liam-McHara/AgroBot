<script lang="ts">
  import { onMount } from 'svelte';
  import { DEFAULT_SETTINGS, SETTING_KEYS, settingsSchema, type Settings } from '@agrobot/shared';
  import Screen from '../../lib/components/Screen.svelte';
  import AdminNav from '../../lib/components/AdminNav.svelte';
  import { fetchSettings, updateSettings } from '../../lib/api/settings.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { toasts } from '../../lib/stores/toast.svelte.js';
  import { haptic } from '../../lib/telegram.js';

  let values = $state<Settings>({ ...DEFAULT_SETTINGS });
  let saved = $state<Settings | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  const numericKeys = SETTING_KEYS.filter((key) => key !== 'notify_new_offer');
  const valid = $derived(settingsSchema.safeParse(values).success);
  const changed = $derived(
    saved !== null && SETTING_KEYS.some((key) => values[key] !== saved?.[key]),
  );

  async function load(): Promise<void> {
    loading = true;
    try {
      saved = await fetchSettings();
      values = { ...saved };
    } catch (error) {
      toasts.error(error);
    } finally {
      loading = false;
    }
  }
  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!valid || !changed || saving || !saved) return;
    saving = true;
    // Send only edits, so another admin's unrelated change is not overwritten.
    const patch = Object.fromEntries(
      SETTING_KEYS.filter((key) => values[key] !== saved?.[key]).map((key) => [key, values[key]]),
    );
    try {
      saved = await updateSettings(patch);
      values = { ...saved };
      haptic('success');
      toasts.success(t('common.saved'));
    } catch (error) {
      toasts.error(error);
    } finally {
      saving = false;
    }
  }
  onMount(() => {
    void load();
  });
</script>

<Screen title={t('admin.settings.title')}>
  <AdminNav />
  {#if loading}
    <p>{t('common.loading')}</p>
  {:else if saved === null}
    <button onclick={load}>{t('common.retry')}</button>
  {:else}
    <p class="hint">{t('admin.settings.hint')}</p>
    <form onsubmit={save}>
      <fieldset disabled={saving}>
        {#each numericKeys as key (key)}
          <label for={key}>{t(`admin.settings.${key}`)}</label>
          <input
            id={key}
            type="number"
            bind:value={values[key]}
            step={key.includes('hours') ? 'any' : 1}
            min={key === 'reservation_expiry_hours'
              ? 1 / 60
              : key === 'offer_nudge_days' || key === 'offer_stale_days_after_nudge'
                ? 1
                : 0}
            max={key.includes('hours') ? 720 : 365}
            required
            aria-invalid={!settingsSchema.shape[key].safeParse(values[key]).success}
            aria-describedby={`${key}-hint`}
          />
          <p id={`${key}-hint`} class="hint">{t(`admin.settings.${key}.hint`)}</p>
        {/each}
        <label class="toggle"
          ><input type="checkbox" bind:checked={values.notify_new_offer} />{t(
            'admin.settings.notify_new_offer',
          )}</label
        >
        <button type="submit" disabled={!valid || !changed || saving}>{t('common.save')}</button>
      </fieldset>
    </form>
  {/if}
</Screen>

<style>
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  input[type='number'] {
    min-height: var(--agrobot-touch-target);
    padding: 0 12px;
    border: 1px solid var(--agrobot-hint);
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
    font: inherit;
  }
  input[aria-invalid='true'] {
    border-color: var(--agrobot-destructive);
  }
  .hint {
    color: var(--agrobot-hint);
    margin: 0 0 12px;
    font-size: 0.85rem;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: var(--agrobot-touch-target);
  }
  button:disabled {
    opacity: 0.5;
  }
</style>
