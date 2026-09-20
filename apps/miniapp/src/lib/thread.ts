import {
  localDateString,
  type MessageKey,
  type MessageParams,
  type MessageView,
  type MessagesResponse,
  type SystemLineMeta,
} from '@agrobot/shared';
import { fetchMessages } from './api/threads.js';

/** Pure helpers of the thread screen (PRD US-5.1, US-5.2). */

/**
 * The whole thread, oldest first: pages of `after` until none remain (ARCH §11). A thread is
 * the conversation about one delivery, so this is one request in practice, and refetching it
 * whole on every `message.new` (ARCH §7 "react by refetching") can never miss a message that
 * committed out of order.
 */
export async function loadThread(
  reservationId: string,
  fetchPage: (reservationId: string, after?: string) => Promise<MessagesResponse> = fetchMessages,
): Promise<MessageView[]> {
  const all: MessageView[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await fetchPage(reservationId, after);
    all.push(...page.messages);
    const last = page.messages.at(-1);
    if (!page.hasMore || !last) return all;
    after = last.id;
  }
}

const order = (a: MessageView, b: MessageView) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

/** The list with `message` in it: replaced if already there, otherwise inserted in order. */
export function mergeMessage(messages: MessageView[], message: MessageView): MessageView[] {
  const rest = messages.filter((m) => m.id !== message.id);
  return [...rest, message].sort(order);
}

/** PRD US-5.1: "Marta confirmed the reservation", from a system line's `meta`. */
export function systemLine(meta: SystemLineMeta): { key: MessageKey; params: MessageParams } {
  if (meta.event === 'cancelled' && meta.cause === 'product_rejected') {
    return { key: 'thread.system.cancelled_product_rejected', params: {} };
  }
  return { key: `thread.system.${meta.event}`, params: { actor: meta.actorName ?? '' } };
}

/** PRD US-5.2: the native conversation, only when the counterpart has a public username. */
export function telegramLink(username: string | null): string | null {
  return username ? `https://t.me/${username}` : null;
}

/** A message from today on the farm shows its time; an older one its date and time. */
export function stampStyle(createdAt: string, now: Date = new Date()): 'time' | 'datetime' {
  return localDateString(new Date(createdAt)) === localDateString(now) ? 'time' : 'datetime';
}
