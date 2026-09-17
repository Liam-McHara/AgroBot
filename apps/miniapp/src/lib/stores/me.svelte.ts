import type { Me } from '@agrobot/shared';
import { apiFetch, type ApiError } from '../api/client.js';
import { setLanguage } from '../i18n/index.svelte.js';

/**
 * The `GET /me` store (ARCH §12). Svelte 5 runes, one instance for the whole app: every
 * screen reads the same profile and `refetch()` is what the SSE store will call from M3.
 */
class MeStore {
  me = $state<Me | null>(null);
  loading = $state(false);
  error = $state<ApiError | Error | null>(null);

  async refetch(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const me = await apiFetch<Me>('/me');
      this.me = me;
      setLanguage(me.language);
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.me = null;
    } finally {
      this.loading = false;
    }
  }
}

export const meStore = new MeStore();
