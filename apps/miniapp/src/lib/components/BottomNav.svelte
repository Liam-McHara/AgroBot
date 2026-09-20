<script lang="ts">
  import { link, router } from 'svelte-spa-router';
  import { t } from '../i18n/index.svelte.js';
  import { meStore } from '../stores/me.svelte.js';

  /**
   * ARCH §12: Board · My offers · Reservations (badge) · Settings · Admin (if admin). The
   * badge is the unread total of `GET /me` (PRD US-4.6), refreshed over the socket.
   */
  const unread = $derived(meStore.me?.unread.total ?? 0);
  const tabs = $derived([
    { href: '/', label: t('nav.board'), icon: '🧺', badge: 0 },
    { href: '/offers', label: t('nav.offers'), icon: '🌱', badge: 0 },
    { href: '/reservations', label: t('nav.reservations'), icon: '🤝', badge: unread },
    { href: '/settings', label: t('nav.settings'), icon: '⚙️', badge: 0 },
    ...(meStore.isAdmin
      ? [{ href: '/admin/members', label: t('nav.admin'), icon: '🛡️', badge: 0 }]
      : []),
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
      {#if tab.badge > 0}
        <span
          class="badge"
          data-testid="nav-unread"
          aria-label={t('thread.unread', { count: tab.badge })}
          >{tab.badge > 99 ? '99+' : tab.badge}</span
        >
      {/if}
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
    position: relative;
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

  .badge {
    position: absolute;
    top: 4px;
    left: calc(50% + 8px);
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--agrobot-destructive);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
  }
</style>
