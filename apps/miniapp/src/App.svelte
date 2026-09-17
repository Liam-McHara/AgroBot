<script lang="ts">
  import Router from 'svelte-spa-router';
  import Hello from './routes/Hello.svelte';

  /**
   * ARCH §12 lists the screens this router will carry: board, offers, reservations, thread,
   * settings, admin and the gate. M0 has one, and every path lands on it.
   */
  const routes = {
    '/': Hello,
    '*': Hello,
  };
</script>

<Router {routes} />
