import {
  realtimeEventSchema,
  type EventsTicketResponse,
  type RealtimeEvent,
  type RealtimeEventType,
  type SocketClientMessage,
} from '@agrobot/shared';
import { api } from '../api/client.js';

/**
 * The realtime store (ARCH §7, §12): one WebSocket for the whole Mini App.
 *
 * Opening it is two steps: `POST /api/events/ticket` with the usual authorization, then the
 * upgrade with that single-use ticket in the URL. Frames are events the screens react to by
 * refetching (`on('board.changed', …)`), never by patching local state. The socket reconnects
 * with exponential backoff (1 s … 30 s) and, once back, tells the `onReconnect` listeners to
 * refetch everything, so a missed frame costs one extra request and never a stale screen.
 * `setViewing` is the presence message of the chat throttle (ARCH §8).
 */
type EventHandler = (event: RealtimeEvent) => void;

export interface RealtimeOptions {
  /** Where the socket is opened; defaults to this origin with `ws(s)://`. */
  socketUrl?: (ticket: string) => string;
  /** Test seam: a `WebSocket` constructor. */
  createSocket?: (url: string) => WebSocket;
  /** Test seam: how a ticket is obtained. */
  fetchTicket?: () => Promise<EventsTicketResponse>;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export const DEFAULT_MIN_DELAY_MS = 1_000;
export const DEFAULT_MAX_DELAY_MS = 30_000;

function defaultSocketUrl(ticket: string): string {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and discarded here
  const base = new URL('/api/events', globalThis.location.href);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.searchParams.set('ticket', ticket);
  return base.toString();
}

export class RealtimeStore {
  connected = $state(false);

  private socket: WebSocket | null = null;
  // Subscriber registries, never rendered: plain collections on purpose.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly handlers = new Map<RealtimeEventType, Set<EventHandler>>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly reconnectHandlers = new Set<() => void>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private viewing: string | null = null;
  private readonly options: Required<RealtimeOptions>;

  constructor(options: RealtimeOptions = {}) {
    this.options = {
      socketUrl: options.socketUrl ?? defaultSocketUrl,
      createSocket: options.createSocket ?? ((url) => new WebSocket(url)),
      fetchTicket: options.fetchTicket ?? (() => api.post<EventsTicketResponse>('/events/ticket')),
      minDelayMs: options.minDelayMs ?? DEFAULT_MIN_DELAY_MS,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    };
  }

  /** Open the socket (once `GET /me` has answered); idempotent. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    void this.connect();
  }

  /** Close the socket and stop reconnecting. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    socket?.close();
  }

  /** Subscribe to one event type; returns the unsubscribe function. */
  on(type: RealtimeEventType, handler: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- see `handlers`
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /** Called after a lost socket comes back: refetch what the screen shows. */
  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => {
      this.reconnectHandlers.delete(handler);
    };
  }

  /** ARCH §7 presence: the thread on screen, or `null` when leaving it. Survives reconnects. */
  setViewing(reservationId: string | null): void {
    this.viewing = reservationId;
    this.send({ viewing: reservationId });
  }

  private send(message: SocketClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let ticket: string;
    try {
      ticket = (await this.options.fetchTicket()).ticket;
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const socket = this.options.createSocket(this.options.socketUrl(ticket));
    this.socket = socket;

    socket.onopen = () => {
      if (socket !== this.socket) return;
      const reconnected = this.attempt > 0;
      this.attempt = 0;
      this.connected = true;
      if (this.viewing !== null) this.send({ viewing: this.viewing });
      if (reconnected) for (const handler of this.reconnectHandlers) handler();
    };
    socket.onmessage = (message: MessageEvent<unknown>) => {
      if (typeof message.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      const result = realtimeEventSchema.safeParse(parsed);
      if (!result.success) return;
      for (const handler of this.handlers.get(result.data.type) ?? []) handler(result.data);
    };
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.connected = false;
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // The close event follows and does the bookkeeping; closing makes sure it comes.
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const backoff = Math.min(this.options.maxDelayMs, this.options.minDelayMs * 2 ** this.attempt);
    // A little jitter so a hundred Mini Apps do not knock at the same millisecond.
    const delay = backoff + Math.floor(Math.random() * this.options.minDelayMs * 0.25);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }
}

export const realtime = new RealtimeStore();
