<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A titled screen with the standard padding and room for the bottom navigation. */
  let { title, children }: { title?: string; children: Snippet } = $props();
</script>

<main>
  {#if title}
    <h1>{title}</h1>
  {/if}
  {@render children()}
</main>

<style>
  main {
    padding: var(--agrobot-space);
    padding-bottom: calc(var(--agrobot-nav-height) + var(--agrobot-space) * 2);
    display: flex;
    flex-direction: column;
    gap: var(--agrobot-space);
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
  }
</style>
