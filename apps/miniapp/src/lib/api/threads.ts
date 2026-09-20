import type { MessageResponse, MessagesResponse, ReadThreadResponse } from '@agrobot/shared';
import { api } from './client.js';

/** The M5 endpoints of ARCH §11 (`/reservations/:id/messages`, `/read`), typed by the contracts. */

export const fetchMessages = (reservationId: string, after?: string, limit?: number) => {
  const query = new URLSearchParams();
  if (after) query.set('after', after);
  if (limit) query.set('limit', String(limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.get<MessagesResponse>(`/reservations/${reservationId}/messages${suffix}`);
};
export const postMessage = (reservationId: string, body: string) =>
  api.post<MessageResponse>(`/reservations/${reservationId}/messages`, { body });
export const readThread = (reservationId: string) =>
  api.post<ReadThreadResponse>(`/reservations/${reservationId}/read`);
