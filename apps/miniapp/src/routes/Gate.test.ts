import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Gate from './Gate.svelte';
import { setLanguage } from '../lib/i18n/index.svelte.js';

vi.mock('../lib/api/members.js', () => ({ fetchMe: vi.fn(), updateMe: vi.fn() }));

beforeEach(() => setLanguage('ca'));
afterEach(cleanup);

describe('Gate screen (PRD §2, ARCH §12)', () => {
  it('tells an applicant their request was sent', () => {
    render(Gate, { status: 'pending' });
    expect(screen.getByRole('heading').textContent).toBe('Sol·licitud enviada');
    expect(screen.getByTestId('gate').dataset['status']).toBe('pending');
  });

  it('shows the rejected and suspended doors, in Spanish too (ADR-0007)', () => {
    setLanguage('es');
    const rejected = render(Gate, { status: 'rejected' });
    expect(screen.getByRole('heading').textContent).toBe('Acceso no aceptado');
    rejected.unmount();
    render(Gate, { status: 'suspended' });
    expect(screen.getByRole('heading').textContent).toBe('Acceso suspendido');
    expect(screen.getByRole('button').textContent?.trim()).toBe('Volver a comprobar');
  });
});
