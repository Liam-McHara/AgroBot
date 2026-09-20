import type {
  CreateReservation,
  ReservationAction,
  ReservationActionBody,
  ReservationResponse,
  ReservationSide,
  ReservationState,
  ReservationsResponse,
} from '@agrobot/shared';
import { api } from './client.js';

/** The M4 endpoints of ARCH §11 (`/reservations`), typed by the shared contracts. */

export const createReservation = (body: CreateReservation) =>
  api.post<ReservationResponse>('/reservations', body);
export const fetchReservations = (side: ReservationSide, state: ReservationState) =>
  api.get<ReservationsResponse>(`/reservations?side=${side}&state=${state}`);
export const fetchReservation = (id: string) => api.get<ReservationResponse>(`/reservations/${id}`);
export const actOnReservation = (
  id: string,
  action: ReservationAction,
  body: ReservationActionBody = {},
) => api.post<ReservationResponse>(`/reservations/${id}/${action}`, body);
