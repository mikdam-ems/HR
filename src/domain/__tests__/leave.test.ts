import { describe, expect, it } from 'vitest';
import { annualEntitlementDays, availableBalance, countLeaveDays } from '../leave';
import { ctx } from './fixtures';

describe('leave days used', () => {
  it('skips weekends and client holidays in the range', () => {
    // Sun 20 – Sat 26 Sep 2026: Wed 23 is Saudi National Day, Fri/Sat are weekend.
    expect(countLeaveDays(ctx, 'omar', '2026-09-20', '2026-09-26')).toBe(4);
  });

  it('a Jordanian holiday while the client works still uses a leave day', () => {
    expect(countLeaveDays(ctx, 'omar', '2026-05-25', '2026-05-25')).toBe(1);
  });

  it('counts a half day', () => {
    expect(countLeaveDays(ctx, 'omar', '2026-09-21', '2026-09-21', { halfDay: true })).toBe(0.5);
  });

  it('rejects a half day across several dates', () => {
    expect(() => countLeaveDays(ctx, 'omar', '2026-09-21', '2026-09-22', { halfDay: true })).toThrow();
  });
});

describe('annual entitlement (Jordan default, HR to confirm)', () => {
  it('is 14 days before 5 years of service', () => {
    expect(annualEntitlementDays('2022-03-10', '2027-03-09')).toBe(14);
  });

  it('is 21 days from the 5-year anniversary', () => {
    expect(annualEntitlementDays('2022-03-10', '2027-03-10')).toBe(21);
  });
});

describe('balance', () => {
  it('is entitlement + carry-over + adjustments − taken − pending', () => {
    expect(availableBalance({ entitlement: 14, carriedOver: 0, adjustments: 0, taken: 5, pending: 2 })).toBe(7);
  });
});
