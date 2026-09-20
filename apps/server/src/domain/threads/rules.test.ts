import { describe, expect, it } from 'vitest';
import { MESSAGE_PREVIEW_LENGTH } from '@agrobot/shared';
import { chatDedupeKey, previewOf, threadWindowOf } from './rules.js';

const DAY = 86_400_000;
const closedAt = new Date('2026-09-19T08:00:00Z');

describe('thread window (PRD US-5.1)', () => {
  it('is open without a deadline while the reservation is active', () => {
    for (const status of ['pending', 'confirmed'] as const) {
      expect(threadWindowOf({ status, closedAt: null }, 7, closedAt)).toEqual({
        writable: true,
        writableUntil: null,
      });
    }
  });

  it('stays open for the configured days after closing, then turns read-only', () => {
    const until = new Date(closedAt.getTime() + 7 * DAY);
    for (const status of ['delivered', 'rejected', 'cancelled', 'expired'] as const) {
      expect(threadWindowOf({ status, closedAt }, 7, closedAt)).toEqual({
        writable: true,
        writableUntil: until,
      });
      expect(threadWindowOf({ status, closedAt }, 7, new Date(until.getTime() - 1)).writable).toBe(
        true,
      );
      expect(threadWindowOf({ status, closedAt }, 7, until).writable).toBe(false);
      expect(
        threadWindowOf({ status, closedAt }, 7, new Date(closedAt.getTime() + 8 * DAY)).writable,
      ).toBe(false);
    }
  });

  it('follows the setting, and a closed reservation without a closing time is read-only', () => {
    expect(
      threadWindowOf({ status: 'delivered', closedAt }, 1, new Date(closedAt.getTime() + 2 * DAY)),
    ).toEqual({ writable: false, writableUntil: new Date(closedAt.getTime() + DAY) });
    expect(threadWindowOf({ status: 'delivered', closedAt: null }, 7, closedAt)).toEqual({
      writable: false,
      writableUntil: null,
    });
  });
});

describe('N9 preview and throttle key (PRD N9, ARCH §8 step 3)', () => {
  it('flattens whitespace and cuts long messages with an ellipsis, by character', () => {
    expect(previewOf('  Demà\n\n a les   10?  ')).toBe('Demà a les 10?');
    const long = '🥚'.repeat(MESSAGE_PREVIEW_LENGTH + 5);
    const preview = previewOf(long);
    expect(Array.from(preview)).toHaveLength(MESSAGE_PREVIEW_LENGTH);
    expect(preview.endsWith('…')).toBe(true);
    expect(previewOf('x'.repeat(MESSAGE_PREVIEW_LENGTH))).toBe('x'.repeat(MESSAGE_PREVIEW_LENGTH));
    // The cut falls on the space after the x's: it is trimmed before the ellipsis.
    expect(previewOf(`${'x'.repeat(MESSAGE_PREVIEW_LENGTH - 2)}   yyyy`)).toBe(
      `${'x'.repeat(MESSAGE_PREVIEW_LENGTH - 2)}…`,
    );
  });

  it('keys the throttle by thread and recipient', () => {
    expect(chatDedupeKey('r1', 'm1')).toBe('chat:r1:m1');
  });
});
