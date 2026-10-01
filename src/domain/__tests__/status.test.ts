import { describe, expect, it } from 'vitest';
import { isStatusVisible, statusShowsUntil } from '../status';

// 2026-10-01 is a Thursday; 2026-10-03 the Saturday after it.
describe('statusShowsUntil', () => {
  it('ends today, at the end of the week (Saturday), or never', () => {
    expect(statusShowsUntil('today', '2026-10-01')).toBe('2026-10-01');
    expect(statusShowsUntil('week', '2026-10-01')).toBe('2026-10-03');
    expect(statusShowsUntil('until_cleared', '2026-10-01')).toBeNull();
  });

  it('counts the week from Sunday, so a Sunday status lasts six days and a Saturday one just that day', () => {
    expect(statusShowsUntil('week', '2026-09-27')).toBe('2026-10-03');
    expect(statusShowsUntil('week', '2026-10-03')).toBe('2026-10-03');
  });
});

describe('isStatusVisible', () => {
  it('shows from the day it was set through its last day', () => {
    const status = { setOn: '2026-10-01', until: '2026-10-03' };
    expect(isStatusVisible(status, '2026-10-01')).toBe(true);
    expect(isStatusVisible(status, '2026-10-03')).toBe(true);
    expect(isStatusVisible(status, '2026-10-04')).toBe(false);
    expect(isStatusVisible(status, '2026-09-30')).toBe(false);
  });

  it('keeps a status with no end until it is cleared', () => {
    expect(isStatusVisible({ setOn: '2026-01-01', until: null }, '2026-10-01')).toBe(true);
  });

  it('shows nothing when no status was ever set', () => {
    expect(isStatusVisible({ setOn: null, until: null }, '2026-10-01')).toBe(false);
  });
});
