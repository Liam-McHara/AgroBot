import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { DEFAULT_SETTINGS, NO_UNREAD, type Me } from '@agrobot/shared';
import BottomNav from './BottomNav.svelte';
import { setLanguage } from '../i18n/index.svelte.js';
import { meStore } from '../stores/me.svelte.js';

const MARTA: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  telegramId: '900000001',
  username: 'marta',
  displayName: 'Marta',
  language: 'ca',
  role: 'member',
  status: 'approved',
  settings: DEFAULT_SETTINGS,
  unread: NO_UNREAD,
};

beforeEach(() => {
  setLanguage('ca');
  meStore.me = MARTA;
});
afterEach(cleanup);

describe('bottom navigation (ARCH §12)', () => {
  it('shows the four member tabs and no badge without unread messages', () => {
    render(BottomNav);
    expect(screen.getAllByRole('link').map((a) => a.textContent?.trim())).toEqual([
      expect.stringContaining('Tauler'),
      expect.stringContaining('Ofertes'),
      expect.stringContaining('Reserves'),
      expect.stringContaining('Ajustos'),
    ]);
    expect(screen.queryByTestId('nav-unread')).toBeNull();
  });

  it('badges the Reservations tab with the unread total (PRD US-4.6) and adds the admin tab', () => {
    meStore.me = { ...MARTA, role: 'admin', unread: { total: 3, incoming: 1, outgoing: 2 } };
    render(BottomNav);
    const badge = screen.getByTestId('nav-unread');
    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('3 missatges sense llegir');
    expect(badge.closest('a')?.textContent).toContain('Reserves');
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });
});
