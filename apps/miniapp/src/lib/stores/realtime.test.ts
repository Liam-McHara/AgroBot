import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeStore } from './realtime.svelte.js';

/**
 * ARCH §7, §12: the realtime store against a scripted `WebSocket`. Time is faked so the
 * backoff can be checked to the millisecond.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

function storeUnderTest(tickets: Array<string | Error> = ['t1', 't2', 't3', 't4']) {
  let call = 0;
  const fetchTicket = vi.fn(async () => {
    const next = tickets[Math.min(call, tickets.length - 1)]!;
    call += 1;
    if (next instanceof Error) throw next;
    return { ticket: next };
  });
  const store = new RealtimeStore({
    fetchTicket,
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    socketUrl: (ticket) => `ws://test/api/events?ticket=${ticket}`,
  });
  return { store, fetchTicket };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RealtimeStore', () => {
  it('opens one socket with a fresh ticket and dispatches parsed events to subscribers', async () => {
    const { store, fetchTicket } = storeUnderTest();
    const seen: unknown[] = [];
    store.on('me.changed', (event) => seen.push(event));
    store.start();
    store.start(); // idempotent
    await flush();

    expect(fetchTicket).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe('ws://test/api/events?ticket=t1');
    socket.open();
    expect(store.connected).toBe(true);

    socket.receive(JSON.stringify({ type: 'me.changed' }));
    socket.receive(JSON.stringify({ type: 'board.changed' })); // nobody listens
    socket.receive('not json');
    socket.receive(JSON.stringify({ type: 'unknown.event' }));
    socket.receive(new ArrayBuffer(2));
    expect(seen).toEqual([{ type: 'me.changed' }]);
  });

  it('reconnects with exponential backoff and refetches once it is back', async () => {
    const { store, fetchTicket } = storeUnderTest();
    const reconnects = vi.fn();
    store.onReconnect(reconnects);
    store.start();
    await flush();
    FakeSocket.instances[0]!.open();
    expect(reconnects).not.toHaveBeenCalled();

    // Connection lost: 1 s, 2 s, 4 s …
    FakeSocket.instances[0]!.close();
    expect(store.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchTicket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1]!.close(); // failed again
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchTicket).toHaveBeenCalledTimes(3);

    FakeSocket.instances[2]!.open();
    expect(store.connected).toBe(true);
    expect(reconnects).toHaveBeenCalledTimes(1);

    // Back to a 1 s delay after a successful connection.
    FakeSocket.instances[2]!.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchTicket).toHaveBeenCalledTimes(4);
  });

  it('caps the delay at 30 s and retries when the ticket request itself fails', async () => {
    const { store, fetchTicket } = storeUnderTest([
      new Error('offline'),
      new Error('offline'),
      new Error('offline'),
      new Error('offline'),
      new Error('offline'),
      new Error('offline'),
      'finally',
    ]);
    store.start();
    await flush();
    expect(fetchTicket).toHaveBeenCalledTimes(1);
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(fetchTicket).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchTicket).toHaveBeenCalledTimes(7);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('sends the presence message when it changes and again after a reconnect', async () => {
    const { store } = storeUnderTest();
    store.start();
    await flush();
    const first = FakeSocket.instances[0]!;
    store.setViewing('22222222-2222-4222-8222-222222222222'); // not open yet: nothing sent
    expect(first.sent).toEqual([]);
    first.open();
    expect(first.sent).toEqual([
      JSON.stringify({ viewing: '22222222-2222-4222-8222-222222222222' }),
    ]);

    first.close();
    await vi.advanceTimersByTimeAsync(1000);
    const second = FakeSocket.instances[1]!;
    second.open();
    expect(second.sent).toEqual([
      JSON.stringify({ viewing: '22222222-2222-4222-8222-222222222222' }),
    ]);
    store.setViewing(null);
    expect(second.sent.at(-1)).toBe(JSON.stringify({ viewing: null }));
  });

  it('stop() closes the socket and stops reconnecting', async () => {
    const { store, fetchTicket } = storeUnderTest();
    store.start();
    await flush();
    FakeSocket.instances[0]!.open();
    store.stop();
    expect(store.connected).toBe(false);
    expect(FakeSocket.instances[0]!.readyState).toBe(FakeSocket.CLOSED);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchTicket).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes', async () => {
    const { store } = storeUnderTest();
    const handler = vi.fn();
    const off = store.on('board.changed', handler);
    store.start();
    await flush();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.receive(JSON.stringify({ type: 'board.changed' }));
    off();
    FakeSocket.instances[0]!.receive(JSON.stringify({ type: 'board.changed' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
