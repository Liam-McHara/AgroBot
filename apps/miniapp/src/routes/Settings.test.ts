import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { DEFAULT_SETTINGS, type Me } from '@agrobot/shared';
import Settings from './Settings.svelte';
import { fetchMe, updateMe } from '../lib/api/members.js';
import { language, setLanguage } from '../lib/i18n/index.svelte.js';
import { meStore } from '../lib/stores/me.svelte.js';
import { toasts } from '../lib/stores/toast.svelte.js';

vi.mock('../lib/api/members.js', () => ({ fetchMe: vi.fn(), updateMe: vi.fn() }));

const MARTA: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  telegramId: '900000001',
  username: 'marta',
  displayName: 'Marta',
  language: 'ca',
  role: 'member',
  status: 'approved',
  settings: DEFAULT_SETTINGS,
};

beforeEach(async () => {
  vi.mocked(fetchMe).mockReset();
  vi.mocked(updateMe).mockReset();
  vi.mocked(fetchMe).mockResolvedValue(MARTA);
  await meStore.refetch();
  setLanguage('ca');
  toasts.dismiss();
});
afterEach(cleanup);

describe('Settings screen (PRD US-1.5)', () => {
  it('switches the language instantly and persists it', async () => {
    vi.mocked(updateMe).mockResolvedValue({ ...MARTA, language: 'es' });
    render(Settings);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ajustos');

    await fireEvent.click(screen.getByRole('radio', { name: 'Castellà' }));
    // Re-rendered before the server answered (US-1.5 "re-renders instantly").
    expect(language()).toBe('es');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ajustes'),
    );
    expect(updateMe).toHaveBeenCalledWith({ language: 'es' });
  });

  it('reverts the language when the server refuses', async () => {
    vi.mocked(updateMe).mockRejectedValue(new Error('offline'));
    render(Settings);
    await fireEvent.click(screen.getByRole('radio', { name: 'Castellà' }));
    await waitFor(() => expect(language()).toBe('ca'));
    expect(toasts.current).toMatchObject({ kind: 'error', message: 'offline' });
  });

  it('saves a display name only when it is valid and changed', async () => {
    vi.mocked(updateMe).mockResolvedValue({ ...MARTA, displayName: 'Marta Puig' });
    render(Settings);
    const input = screen.getByLabelText('Nom que veuran els altres');
    const save = screen.getByRole('button', { name: 'Desa' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await fireEvent.input(input, { target: { value: 'M' } });
    expect(save.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    await fireEvent.input(input, { target: { value: '  Marta Puig ' } });
    expect(save.disabled).toBe(false);
    await fireEvent.submit(save.closest('form')!);
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ displayName: 'Marta Puig' }));
    await waitFor(() => expect(meStore.me?.displayName).toBe('Marta Puig'));
  });
});
