import type {
  AdminCatalog,
  ProductResponse,
  ProductsResponse,
  ProposeProduct,
  SyncResponse,
} from '@agrobot/shared';
import { api } from './client.js';

export const fetchProducts = (q = '') =>
  api.get<ProductsResponse>(`/products?q=${encodeURIComponent(q)}&includePending=1`);
export const proposeProduct = (body: ProposeProduct) =>
  api.post<ProductResponse>('/products/proposals', body);
export const fetchCatalog = () => api.get<AdminCatalog>('/admin/catalog');
export const syncCatalog = () => api.post<SyncResponse>('/admin/catalog/sync');
export const renameProduct = (id: string, name: string) =>
  api.post<ProductResponse>(`/admin/products/${id}/rename`, { name });
export const rejectProduct = (id: string) => api.post<void>(`/admin/products/${id}/reject`);
