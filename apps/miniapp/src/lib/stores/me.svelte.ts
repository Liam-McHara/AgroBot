import type { Me, UpdateMe } from '@agrobot/shared';
import { fetchMe, updateMe } from '../api/members.js';
import type { ApiError } from '../api/client.js';
import { setLanguage } from '../i18n/index.svelte.js';

/**
 * The `GET /me` store (ARCH §12). Svelte 5 runes, one instance for the whole app: every
 * screen reads the same profile and `refetch()` is what the realtime store calls on
 * `me.changed` (ARCH §7).
 */
class MeStore {
  me = $state<Me | null>(null);
  loading = $state(false);
  error = $state<ApiError | Error | null>(null);

  get isApproved(): boolean {
    return this.me?.status === 'approved';
  }

  get isAdmin(): boolean {
    return this.isApproved && this.me?.role === 'admin';
  }

  async refetch(): Promise<void> {
    this.loading = this.me === null;
    this.error = null;
    try {
      this.apply(await fetchMe());
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      if (this.me === null) this.me = null;
    } finally {
      this.loading = false;
    }
  }

  /** PRD US-1.5. The language switches before the request so the screen re-renders at once. */
  async update(patch: UpdateMe): Promise<void> {
    const previous = this.me;
    if (patch.language) setLanguage(patch.language);
    try {
      this.apply(await updateMe(patch));
    } catch (error) {
      if (previous) this.apply(previous);
      throw error;
    }
  }

  private apply(me: Me): void {
    this.me = me;
    setLanguage(me.language);
  }
}

export const meStore = new MeStore();
