import type { BoardGrouping, BoardView } from '@agrobot/shared';
import { fetchBoard, type BoardParams } from '../api/offers.js';

/**
 * The board store (ARCH §12, PRD US-3.3): the current filters and what the API answered for
 * them. `refetch()` is what the realtime store calls on `board.changed` and on reconnect
 * (ARCH §7); a stale answer that arrives after the filters changed is dropped, never shown.
 */
export class BoardStore {
  params = $state<BoardParams>({ group: 'product', q: '', category: '' });
  data = $state<BoardView | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);

  private request = 0;

  constructor(private readonly load: (params: BoardParams) => Promise<BoardView> = fetchBoard) {}

  async refetch(): Promise<void> {
    const current = ++this.request;
    const params = { ...this.params };
    this.loading = this.data === null;
    try {
      const view = await this.load(params);
      if (current !== this.request) return;
      this.data = view;
      this.error = null;
    } catch (error) {
      if (current !== this.request) return;
      this.error = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (current === this.request) this.loading = false;
    }
  }

  setGroup(group: BoardGrouping): Promise<void> {
    this.params = { ...this.params, group };
    return this.refetch();
  }

  setQuery(q: string): Promise<void> {
    this.params = { ...this.params, q };
    return this.refetch();
  }

  /** The same chip tapped again clears the filter. */
  toggleCategory(category: string): Promise<void> {
    this.params = {
      ...this.params,
      category: this.params.category === category ? '' : category,
    };
    return this.refetch();
  }
}

export const boardStore = new BoardStore();
