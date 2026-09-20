import { z } from 'zod';
import { MESSAGE_KINDS, MESSAGE_MAX_LENGTH, RESERVATION_EVENTS } from '../enums.js';

/**
 * PRD US-5.1 and ARCH §5 `messages`, §11 `/reservations/:id/messages` and `/read` (ADR-0005).
 * A thread is the two parties' conversation about one reservation: their text messages and
 * the system lines the transitions of ARCH §6 write. Reading is what clears the unread badges
 * and re-arms the N9 throttle (ARCH §8 step 3).
 */

/** `POST /reservations/:id/messages`: 1–2000 characters once trimmed (PRD US-5.1). */
export const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});
export type PostMessage = z.infer<typeof postMessageSchema>;

/**
 * ARCH §5: what a system line stores in `meta`. The reader's language decides the wording;
 * `actorName` is the name at the time (snapshotted), `null` when a job or an admin's catalogue
 * decision caused the transition, in which case `cause` says which.
 */
export const systemLineMetaSchema = z.object({
  event: z.enum(RESERVATION_EVENTS),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  cause: z.enum(['product_rejected']).nullable(),
});
export type SystemLineMeta = z.infer<typeof systemLineMetaSchema>;

export const messageSenderSchema = z.object({ id: z.uuid(), displayName: z.string() });
export type MessageSender = z.infer<typeof messageSenderSchema>;

/** One line of the thread as one of its parties sees it. */
export const messageSchema = z.object({
  id: z.uuid(),
  reservationId: z.uuid(),
  kind: z.enum(MESSAGE_KINDS),
  /** The text of a text message; for a system line, the event code (`meta` is what is shown). */
  body: z.string(),
  /** Who wrote it; `null` for a system line. */
  sender: messageSenderSchema.nullable(),
  /** Whether the viewer wrote it, so the screen can put it on the right side. */
  mine: z.boolean(),
  meta: systemLineMetaSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type MessageView = z.infer<typeof messageSchema>;

/** ARCH §11 `GET /reservations/:id/messages?after=<id>`: pages of this many, oldest first. */
export const THREAD_PAGE_SIZE = 100;

export const messagesQuerySchema = z.object({
  /** The last message already held; the answer starts after it. */
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(THREAD_PAGE_SIZE).default(THREAD_PAGE_SIZE),
});
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

export const messagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  /** More follow the last one returned: ask again with `after` set to its id. */
  hasMore: z.boolean(),
});
export type MessagesResponse = z.infer<typeof messagesResponseSchema>;

export const messageResponseSchema = z.object({ message: messageSchema });
export type MessageResponse = z.infer<typeof messageResponseSchema>;

/**
 * PRD US-4.6 unread badges: text messages from the counterpart that the member has not read,
 * in total and per side of *My reservations*. System lines never count; N8 already tells the
 * other party about a transition.
 */
export const unreadCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  incoming: z.number().int().nonnegative(),
  outgoing: z.number().int().nonnegative(),
});
export type UnreadCounts = z.infer<typeof unreadCountsSchema>;

export const NO_UNREAD: UnreadCounts = { total: 0, incoming: 0, outgoing: 0 };

/**
 * PRD US-5.1: the thread is writable while the reservation is active and for
 * `thread_readonly_days_after_close` after it closes. `writableUntil` is that deadline once
 * the reservation has closed, `null` while it is active.
 */
export const threadStateSchema = z.object({
  writable: z.boolean(),
  writableUntil: z.iso.datetime().nullable(),
});
export type ThreadState = z.infer<typeof threadStateSchema>;

/** `POST /reservations/:id/read`: the member's badges once this thread counts as read. */
export const readThreadResponseSchema = z.object({ unread: unreadCountsSchema });
export type ReadThreadResponse = z.infer<typeof readThreadResponseSchema>;
