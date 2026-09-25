import type { Settings, UpdateSettings } from '@agrobot/shared';
import { api } from './client.js';

export const fetchSettings = () => api.get<Settings>('/admin/settings');
export const updateSettings = (input: UpdateSettings) =>
  api.patch<Settings>('/admin/settings', input);
