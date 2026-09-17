import { describe, expect, it } from 'vitest';
import type { MemberAction } from '@agrobot/shared';
import {
  applyMemberAction,
  displayNameFrom,
  gateErrorFor,
  resolveAutoApproval,
  wouldRemoveLastAdmin,
  type MemberState,
} from './rules.js';

const identity = {
  id: 42,
  username: 'marta',
  firstName: 'Marta',
  lastName: 'Puig',
  language: 'ca' as const,
};

describe('displayNameFrom (PRD US-1.5)', () => {
  it('joins first and last name', () => {
    expect(displayNameFrom(identity)).toBe('Marta Puig');
  });

  it('falls back to the username, then to the Telegram id', () => {
    expect(displayNameFrom({ ...identity, firstName: null, lastName: null })).toBe('marta');
    expect(displayNameFrom({ ...identity, firstName: null, lastName: null, username: null })).toBe(
      'Telegram 42',
    );
  });

  it('keeps the result within 2–40 characters', () => {
    expect(
      displayNameFrom({ ...identity, firstName: 'M'.repeat(60), lastName: null }),
    ).toHaveLength(40);
    expect(displayNameFrom({ ...identity, firstName: 'M', lastName: null })).toBe('Telegram 42');
  });
});

describe('resolveAutoApproval (PRD US-1.1, US-1.3)', () => {
  it('makes a configured id an admin, even when they also hold an invite', () => {
    expect(resolveAutoApproval({ id: 42 }, { adminTelegramIds: ['42'], hasInvite: true })).toBe(
      'admin',
    );
  });

  it('approves an invited person as member', () => {
    expect(resolveAutoApproval({ id: 42 }, { adminTelegramIds: ['7'], hasInvite: true })).toBe(
      'invite',
    );
  });

  it('leaves everybody else an applicant', () => {
    expect(resolveAutoApproval({ id: 42 }, { adminTelegramIds: [], hasInvite: false })).toBeNull();
  });
});

describe('applyMemberAction (ARCH §6 member machine)', () => {
  const state = (status: MemberState['status'], role: MemberState['role'] = 'member') => ({
    status,
    role,
  });

  const allowed: Array<[MemberState, MemberAction, MemberState]> = [
    [state('pending'), 'approve', state('approved')],
    [state('rejected'), 'approve', state('approved')],
    [state('pending'), 'reject', state('rejected')],
    [state('approved'), 'suspend', state('suspended')],
    [state('approved', 'admin'), 'suspend', state('suspended', 'admin')],
    [state('suspended'), 'reinstate', state('approved')],
    [state('approved'), 'promote', state('approved', 'admin')],
    [state('approved', 'admin'), 'demote', state('approved')],
    [state('suspended', 'admin'), 'demote', state('suspended')],
  ];
  it.each(allowed)('%j + %s → %j', (from, action, to) => {
    expect(applyMemberAction(from, action)).toEqual(to);
  });

  const refused: Array<[MemberState, MemberAction]> = [
    [state('approved'), 'approve'],
    [state('suspended'), 'approve'],
    [state('approved'), 'reject'],
    [state('rejected'), 'reject'],
    [state('pending'), 'suspend'],
    [state('suspended'), 'suspend'],
    [state('approved'), 'reinstate'],
    [state('pending'), 'promote'],
    [state('approved', 'admin'), 'promote'],
    [state('approved'), 'demote'],
  ];
  it.each(refused)('%j + %s is refused', (from, action) => {
    expect(applyMemberAction(from, action)).toBeNull();
  });
});

describe('wouldRemoveLastAdmin (PRD US-1.4)', () => {
  const admin: MemberState = { status: 'approved', role: 'admin' };

  it('refuses to suspend or demote the only approved admin', () => {
    expect(wouldRemoveLastAdmin(admin, 'suspend', 1)).toBe(true);
    expect(wouldRemoveLastAdmin(admin, 'demote', 1)).toBe(true);
  });

  it('allows it when another approved admin remains', () => {
    expect(wouldRemoveLastAdmin(admin, 'demote', 2)).toBe(false);
  });

  it('does not concern members or suspended admins', () => {
    expect(wouldRemoveLastAdmin({ status: 'approved', role: 'member' }, 'suspend', 1)).toBe(false);
    expect(wouldRemoveLastAdmin({ status: 'suspended', role: 'admin' }, 'demote', 0)).toBe(false);
  });
});

describe('gateErrorFor (PRD §2)', () => {
  it('lets members through and names the door for everyone else', () => {
    expect(gateErrorFor({ status: 'approved' })).toBeNull();
    expect(gateErrorFor({ status: 'pending' })).toBe('NOT_APPROVED');
    expect(gateErrorFor({ status: 'rejected' })).toBe('NOT_APPROVED');
    expect(gateErrorFor({ status: 'suspended' })).toBe('SUSPENDED');
  });
});
