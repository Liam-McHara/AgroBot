<script lang="ts">
  import { t } from '../i18n/index.svelte.js';
</script>

<nav aria-label={t('nav.admin')}>
  <a href="#/admin/members">{t('admin.members.title')}</a>
  <a href="#/admin/catalog">{t('catalog.title')}</a>
  <a href="#/admin/settings">{t('admin.settings.title')}</a>
</nav>

<style>
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  a {
    min-height: var(--agrobot-touch-target);
    display: flex;
    align-items: center;
    color: var(--agrobot-link);
  }
</style>
