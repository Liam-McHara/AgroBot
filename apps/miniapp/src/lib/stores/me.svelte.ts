import type { Me, UnreadCounts, UpdateMe } from '@agrobot/shared';
import { fetchMe, updateMe } from '../api/members.js';
import type { ApiError } from '../api/client.js';
import { setLanguage } from '../i18n/index.svelte.js';

/**
 * The `GET /me` store (ARCH §12). Svelte 5 runes, one instance for the whole app: every
 * screen reads the same profile and `refetch()` is what the realtime store calls on
 * `me.changed` and `message.new` (ARCH §7), the latter for the unread badge (PRD US-4.6).
 * An answer to an older request is dropped, so two refetches in flight cannot end on the
 * stale one.
 */
class MeStore {
  me = $state<Me | null>(null);
  loading = $state(false);
  error = $state<ApiError | Error | null>(null);

  private request = 0;

  get isApproved(): boolean {
    return this.me?.status === 'approved';
  }

  get isAdmin(): boolean {
    return this.isApproved && this.me?.role === 'admin';
  }

  async refetch(): Promise<void> {
    const current = ++this.request;
    this.loading = this.me === null;
    this.error = null;
    try {
      const me = await fetchMe();
      if (current !== this.request) return;
      this.apply(me);
    } catch (error) {
      if (current !== this.request) return;
      this.error = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (current === this.request) this.loading = false;
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

  /**
   * PRD US-4.6: the badges as `POST /reservations/:id/read` just answered. Fresher than any
   * refetch already in flight, which is therefore dropped.
   */
  applyUnread(unread: UnreadCounts): void {
    this.request += 1;
    if (this.me) this.me = { ...this.me, unread };
  }

  private apply(me: Me): void {
    this.me = me;
    setLanguage(me.language);
  }
}

export const meStore = new MeStore();
