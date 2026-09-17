<script lang="ts">
  import {
    DISPLAY_NAME_MAX_LENGTH,
    DISPLAY_NAME_MIN_LENGTH,
    LANGUAGES,
    type Language,
  } from '@agrobot/shared';
  import Screen from '../lib/components/Screen.svelte';
  import { t } from '../lib/i18n/index.svelte.js';
  import { meStore } from '../lib/stores/me.svelte.js';
  import { toasts } from '../lib/stores/toast.svelte.js';
  import { haptic } from '../lib/telegram.js';

  /** PRD US-1.5: language and display name. ARCH §12 `/settings`, with the version. */
  let displayName = $state(meStore.me?.displayName ?? '');
  let saving = $state(false);

  const trimmed = $derived(displayName.trim());
  const nameValid = $derived(
    trimmed.length >= DISPLAY_NAME_MIN_LENGTH && trimmed.length <= DISPLAY_NAME_MAX_LENGTH,
  );
  const nameChanged = $derived(trimmed !== meStore.me?.displayName);

  async function chooseLanguage(language: Language): Promise<void> {
    if (language === meStore.me?.language) return;
    haptic('selection');
    try {
      await meStore.update({ language });
    } catch (error) {
      toasts.error(error);
    }
  }

  async function saveName(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!nameValid || !nameChanged) return;
    saving = true;
    try {
      await meStore.update({ displayName: trimmed });
      haptic('success');
      toasts.success(t('common.saved'));
    } catch (error) {
      haptic('error');
      toasts.error(error);
    } finally {
      saving = false;
    }
  }
</script>

<Screen title={t('settings.title')}>
  <section>
    <h2>{t('settings.language')}</h2>
    <div class="segmented" role="radiogroup" aria-label={t('settings.language')}>
      {#each LANGUAGES as language (language)}
        <button
          type="button"
          role="radio"
          aria-checked={meStore.me?.language === language}
          class:selected={meStore.me?.language === language}
          onclick={() => chooseLanguage(language)}
        >
          {t(`settings.language.${language}`)}
        </button>
      {/each}
    </div>
  </section>

  <form onsubmit={saveName}>
    <label for="display-name"><h2>{t('settings.display_name')}</h2></label>
    <input
      id="display-name"
      type="text"
      bind:value={displayName}
      minlength={DISPLAY_NAME_MIN_LENGTH}
      maxlength={DISPLAY_NAME_MAX_LENGTH}
      autocomplete="nickname"
      aria-invalid={!nameValid}
    />
    <p class="hint">{t('settings.display_name.hint')}</p>
    <button type="submit" disabled={!nameValid || !nameChanged || saving}>{t('common.save')}</button
    >
  </form>

  <p class="hint version">{t('settings.version', { version: __APP_VERSION__ })}</p>
</Screen>

<style>
  section,
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--agrobot-hint);
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

  input {
    min-height: var(--agrobot-touch-target);
    padding: 0 12px;
    border: 1px solid rgb(0 0 0 / 0.12);
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
    font: inherit;
  }

  input[aria-invalid='true'] {
    border-color: var(--agrobot-destructive);
  }

  .hint {
    margin: 0;
    color: var(--agrobot-hint);
    font-size: 0.85rem;
  }

  .version {
    text-align: center;
    margin-top: var(--agrobot-space);
  }

  button[disabled] {
    opacity: 0.5;
  }
</style>
