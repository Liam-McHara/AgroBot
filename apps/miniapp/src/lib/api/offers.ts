import type {
  BoardGrouping,
  BoardView,
  EditOffer,
  MyOfferResponse,
  MyOffersResponse,
  OfferDetailResponse,
  PublishOffer,
} from '@agrobot/shared';
import { api } from './client.js';

/** The M3 endpoints of ARCH §11 (`/board`, `/offers`), typed by the shared contracts. */

export interface BoardParams {
  group: BoardGrouping;
  q: string;
  category: string;
}

export const fetchBoard = (params: BoardParams) => {
  const search = new URLSearchParams({ group: params.group });
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  return api.get<BoardView>(`/board?${search.toString()}`);
};

export const fetchMyOffers = () => api.get<MyOffersResponse>('/offers/mine');
export const fetchOffer = (id: string) => api.get<OfferDetailResponse>(`/offers/${id}`);
export const publishOffer = (body: PublishOffer) => api.post<MyOfferResponse>('/offers', body);
export const editOffer = (id: string, body: EditOffer) =>
  api.patch<MyOfferResponse>(`/offers/${id}`, body);
export const withdrawOffer = (id: string) => api.post<MyOfferResponse>(`/offers/${id}/withdraw`);
export const confirmStillAvailable = (id: string) =>
  api.post<MyOfferResponse>(`/offers/${id}/still-available`);
