<script lang="ts">
  import { toasts } from '../stores/toast.svelte.js';
</script>

{#if toasts.current}
  <div
    class="toast {toasts.current.kind}"
    role={toasts.current.kind === 'error' ? 'alert' : 'status'}
    onclick={() => toasts.dismiss()}
  >
    {toasts.current.message}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: var(--agrobot-space);
    right: var(--agrobot-space);
    bottom: calc(var(--agrobot-nav-height) + var(--agrobot-space) + env(safe-area-inset-bottom));
    z-index: 10;
    padding: 12px var(--agrobot-space);
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-text);
    color: var(--agrobot-bg);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
  }

  .error {
    background: var(--agrobot-destructive);
    color: #fff;
  }
</style>
