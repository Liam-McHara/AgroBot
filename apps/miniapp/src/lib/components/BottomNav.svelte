<script lang="ts">
  import { link, router } from 'svelte-spa-router';
  import { t } from '../i18n/index.svelte.js';
  import { meStore } from '../stores/me.svelte.js';

  /** ARCH §12: Board · My offers · Reservations · Settings · Admin (if admin). */
  const tabs = $derived([
    { href: '/', label: t('nav.board'), icon: '🧺' },
    { href: '/offers', label: t('nav.offers'), icon: '🌱' },
    { href: '/reservations', label: t('nav.reservations'), icon: '🤝' },
    { href: '/settings', label: t('nav.settings'), icon: '⚙️' },
    ...(meStore.isAdmin ? [{ href: '/admin/members', label: t('nav.admin'), icon: '🛡️' }] : []),
  ]);

  function isActive(href: string): boolean {
    const location = router.location;
    if (href === '/') return location === '/';
    if (href.startsWith('/admin')) return location.startsWith('/admin');
    return location === href || location.startsWith(`${href}/`);
  }
</script>

<nav aria-label="main">
  {#each tabs as tab (tab.href)}
    <a
      href={tab.href}
      use:link
      class:active={isActive(tab.href)}
      aria-current={isActive(tab.href) ? 'page' : undefined}
    >
      <span class="icon" aria-hidden="true">{tab.icon}</span>
      <span class="label">{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    height: calc(var(--agrobot-nav-height) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--agrobot-secondary-bg);
    border-top: 1px solid rgb(0 0 0 / 0.08);
  }

  a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: var(--agrobot-touch-target);
    color: var(--agrobot-hint);
    text-decoration: none;
    font-size: 0.7rem;
  }

  a.active {
    color: var(--agrobot-link);
  }

  .icon {
    font-size: 1.25rem;
  }
</style>
