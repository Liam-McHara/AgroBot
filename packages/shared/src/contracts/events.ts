import { z } from 'zod';

/**
 * ARCH §7 realtime: the frames the hub writes to a member's WebSocket, and what the Mini App
 * may send back. Clients react to an event by refetching the affected query (ADR-0009's
 * rule, unchanged by ADR-0017); the payload only says *what* changed, never *how*.
 */
export const REALTIME_EVENT_TYPES = [
  'board.changed',
  'reservation.changed',
  'message.new',
  'me.changed',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export const realtimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('board.changed') }),
  z.object({ type: z.literal('reservation.changed'), id: z.uuid() }),
  z.object({ type: z.literal('message.new'), reservationId: z.uuid() }),
  z.object({ type: z.literal('me.changed') }),
]);
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

/** `POST /api/events/ticket`: a random, single-use ticket valid for 30 seconds (ARCH §7). */
export const EVENTS_TICKET_TTL_SECONDS = 30;
export const eventsTicketResponseSchema = z.object({ ticket: z.string().min(16) });
export type EventsTicketResponse = z.infer<typeof eventsTicketResponseSchema>;

/** The one message a client sends: which thread it is looking at, for the N9 throttle. */
export const socketClientMessageSchema = z.object({ viewing: z.uuid().nullable() });
export type SocketClientMessage = z.infer<typeof socketClientMessageSchema>;
