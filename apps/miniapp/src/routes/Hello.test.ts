import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import type { Me } from '@agrobot/shared';
import Hello from './Hello.svelte';
import { apiFetch } from '../lib/api/client.js';
import { setLanguage } from '../lib/i18n/index.svelte.js';

vi.mock('../lib/api/client.js', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

const MARTA: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  telegramId: '900000001',
  username: 'marta',
  displayName: 'Marta',
  language: 'ca',
  role: 'member',
  status: 'approved',
};

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  setLanguage('ca');
});

// Vitest is configured without globals, so Testing Library's automatic cleanup never runs.
afterEach(cleanup);

describe('Hello screen', () => {
  it('greets the member in Catalan', async () => {
    vi.mocked(apiFetch).mockResolvedValue(MARTA);
    render(Hello);
    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Hola, Marta!'));
  });

  it('greets a Spanish-speaking member in Spanish (ADR-0007)', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...MARTA, displayName: 'Jordi', language: 'es' });
    render(Hello);
    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('¡Hola, Jordi!'));
  });

  it('shows a retry button when the profile cannot be loaded', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('offline'));
    render(Hello);
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Torna-ho a provar'));
    expect(screen.getByText("No s'ha pogut carregar el teu perfil.")).toBeTruthy();
  });
});
