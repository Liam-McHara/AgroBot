import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { DEFAULT_SETTINGS } from '@agrobot/shared';
import Settings from './Settings.svelte';
import { fetchSettings, updateSettings } from '../../lib/api/settings.js';
import { setLanguage } from '../../lib/i18n/index.svelte.js';
import { toasts } from '../../lib/stores/toast.svelte.js';

vi.mock('../../lib/api/settings.js', () => ({ fetchSettings: vi.fn(), updateSettings: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('ca');
  toasts.dismiss();
  vi.mocked(fetchSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
});
afterEach(cleanup);
it('validates numeric fields, saves only edits, and translates to Spanish', async () => {
  vi.mocked(updateSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, offer_nudge_days: 3 });
  render(Settings);
  const field = await screen.findByLabelText('Dies abans de recordar una oferta');
  const save = screen.getByRole('button', { name: 'Desa' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await fireEvent.input(field, { target: { value: '0' } });
  expect(save.disabled).toBe(true);
  await fireEvent.input(field, { target: { value: '3' } });
  await fireEvent.submit(field.closest('form')!);
  await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ offer_nudge_days: 3 }));
  setLanguage('es');
  await screen.findByRole('heading', { name: 'Configuración del grupo' });
});
it('offers retry after load failure and preserves edits after save failure', async () => {
  vi.mocked(fetchSettings).mockRejectedValueOnce(new Error('load failed'));
  render(Settings);
  await fireEvent.click(await screen.findByRole('button', { name: 'Torna-ho a provar' }));
  const checkbox = await screen.findByRole('checkbox');
  await fireEvent.click(checkbox);
  vi.mocked(updateSettings).mockRejectedValueOnce(new Error('save failed'));
  await fireEvent.submit(checkbox.closest('form')!);
  await waitFor(() => expect(toasts.current?.message).toBe('save failed'));
  expect((checkbox as HTMLInputElement).checked).toBe(false);
});
