import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import {
  DEFAULT_SETTINGS,
  NO_UNREAD,
  type AdminMember,
  type Invite,
  type Me,
} from '@agrobot/shared';
import Members from './Members.svelte';
import {
  adminCreateInvite,
  adminDeleteInvite,
  adminListInvites,
  adminListMembers,
  adminMemberAction,
  fetchMe,
} from '../../lib/api/members.js';
import { setLanguage } from '../../lib/i18n/index.svelte.js';
import { meStore } from '../../lib/stores/me.svelte.js';
import { toasts } from '../../lib/stores/toast.svelte.js';

vi.mock('../../lib/api/members.js', () => ({
  fetchMe: vi.fn(),
  updateMe: vi.fn(),
  adminListMembers: vi.fn(),
  adminMemberAction: vi.fn(),
  adminListInvites: vi.fn(),
  adminCreateInvite: vi.fn(),
  adminDeleteInvite: vi.fn(),
}));

const ADMIN: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  telegramId: '1',
  username: 'guillem',
  displayName: 'Guillem',
  language: 'ca',
  role: 'admin',
  status: 'approved',
  settings: DEFAULT_SETTINGS,
  unread: NO_UNREAD,
};

const member = (overrides: Partial<AdminMember>): AdminMember => ({
  id: '22222222-2222-4222-8222-222222222222',
  telegramId: '2',
  username: 'marta',
  firstName: 'Marta',
  lastName: null,
  displayName: 'Marta',
  language: 'ca',
  role: 'member',
  status: 'pending',
  appliedAt: '2026-09-17T10:00:00.000Z',
  approvedAt: null,
  lastSeenAt: null,
  ...overrides,
});

const adminRow = member({
  ...ADMIN,
  id: ADMIN.id,
  firstName: 'Guillem',
  appliedAt: '2026-09-01T10:00:00.000Z',
});

beforeEach(async () => {
  for (const fn of [
    adminListMembers,
    adminMemberAction,
    adminListInvites,
    adminCreateInvite,
    adminDeleteInvite,
  ]) {
    vi.mocked(fn).mockReset();
  }
  vi.mocked(fetchMe).mockResolvedValue(ADMIN);
  await meStore.refetch();
  setLanguage('ca');
  vi.mocked(adminListInvites).mockResolvedValue({ invites: [] });
  toasts.dismiss();
});
afterEach(cleanup);

describe('Admin → Members (PRD §10, US-1.2–1.4)', () => {
  it('lists applicants and approves one from the row', async () => {
    const marta = member({});
    vi.mocked(adminListMembers).mockResolvedValue({ members: [adminRow, marta] });
    vi.mocked(adminMemberAction).mockResolvedValue({ member: { ...marta, status: 'approved' } });
    render(Members);

    const row = await screen.findByTestId('applicant');
    expect(within(row).getByText('Marta')).toBeTruthy();
    expect(within(row).getByText(/Sol·licitud: 17\/09\/2026/)).toBeTruthy();

    await fireEvent.click(within(row).getByRole('button', { name: 'Aprova' }));
    expect(adminMemberAction).toHaveBeenCalledWith(marta.id, 'approve');
    await waitFor(() => expect(screen.queryByTestId('applicant')).toBeNull());
    expect(screen.getByText('No hi ha cap sol·licitud pendent.')).toBeTruthy();
  });

  it('offers the right actions per state on the members tab', async () => {
    vi.mocked(adminListMembers).mockResolvedValue({
      members: [
        adminRow,
        member({
          id: 'a0000000-0000-4000-8000-000000000001',
          displayName: 'Anna',
          status: 'approved',
        }),
        member({
          id: 'a0000000-0000-4000-8000-000000000002',
          displayName: 'Pere',
          status: 'suspended',
        }),
      ],
    });
    render(Members);
    await screen.findByRole('tab', { name: /Membres/ });
    await fireEvent.click(screen.getByRole('tab', { name: /Membres/ }));

    const rows = await screen.findAllByTestId('member');
    expect(rows).toHaveLength(3);
    const names = (row: HTMLElement) =>
      within(row)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim());
    expect(names(rows[0]!)).toEqual(['Fes-lo/la admin', 'Suspèn']); // Anna
    expect(names(rows[1]!)).toEqual(["Treu-li l'admin", 'Suspèn']); // Guillem (admin)
    expect(within(rows[1]!).getByText('(tu)')).toBeTruthy();
    expect(names(rows[2]!)).toEqual(['Readmet']); // Pere
  });

  it('shows the server error when the last admin cannot be demoted', async () => {
    vi.mocked(adminListMembers).mockResolvedValue({ members: [adminRow] });
    vi.mocked(adminMemberAction).mockRejectedValue(
      new Error('No es pot deixar el grup sense cap administrador.'),
    );
    render(Members);
    await fireEvent.click(await screen.findByRole('tab', { name: /Membres/ }));
    await fireEvent.click(await screen.findByRole('button', { name: "Treu-li l'admin" }));
    await waitFor(() => expect(toasts.current?.message).toContain('sense cap administrador'));
  });

  it('adds and removes a pre-approval, validating the identifier first', async () => {
    vi.mocked(adminListMembers).mockResolvedValue({ members: [adminRow] });
    const invite: Invite = {
      id: 'b0000000-0000-4000-8000-000000000001',
      telegramId: null,
      username: 'joanroca',
      createdAt: '2026-09-17T10:00:00.000Z',
      createdByName: 'Guillem',
      usedAt: null,
      usedByName: null,
    };
    vi.mocked(adminCreateInvite).mockResolvedValue({ invite });
    vi.mocked(adminDeleteInvite).mockResolvedValue(undefined);
    render(Members);
    await fireEvent.click(await screen.findByRole('tab', { name: 'Preaprovats' }));

    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'not a user' } });
    await fireEvent.submit(input.closest('form')!);
    expect(adminCreateInvite).not.toHaveBeenCalled();
    expect(toasts.current?.message).toContain('@usuari');

    await fireEvent.input(input, { target: { value: '@JoanRoca' } });
    await fireEvent.submit(input.closest('form')!);
    expect(adminCreateInvite).toHaveBeenCalledWith({ identifier: '@JoanRoca' });
    const row = await screen.findByTestId('invite');
    expect(within(row).getByText('@joanroca')).toBeTruthy();

    await fireEvent.click(within(row).getByRole('button', { name: 'Elimina' }));
    expect(adminDeleteInvite).toHaveBeenCalledWith(invite.id);
    await waitFor(() => expect(screen.queryByTestId('invite')).toBeNull());
  });
});
