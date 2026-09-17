<script lang="ts">
  import Screen from '../lib/components/Screen.svelte';
  import { t } from '../lib/i18n/index.svelte.js';

  /** ARCH §12: the shell of this screen; its content arrives with its milestone. */
</script>

<Screen title={t('nav.board')}>
  <p class="hint" data-testid="board-placeholder">{t('placeholder.board')}</p>
</Screen>

<style>
  .hint {
    margin: 0;
    color: var(--agrobot-hint);
  }
</style>
