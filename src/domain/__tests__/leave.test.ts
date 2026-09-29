import { describe, expect, it } from 'vitest';
import { annualEntitlementDays, availableBalance, countLeaveDays, leaveCalendarMarks } from '../leave';
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

describe('leave calendar marks', () => {
  it('marks every day of pending and approved requests; approved wins where they meet', () => {
    const marks = leaveCalendarMarks(ctx, 'omar', '2026-09-20', '2026-09-26', [
      { fromDate: '2026-09-21', toDate: '2026-09-22', status: 'pending', type: 'annual' },
      { fromDate: '2026-09-22', toDate: '2026-09-22', status: 'approved', type: 'sick' },
      { fromDate: '2026-09-24', toDate: '2026-09-24', status: 'declined', type: 'annual' },
    ]);
    expect(marks.booked).toEqual({
      '2026-09-21': { status: 'pending', type: 'annual' },
      '2026-09-22': { status: 'approved', type: 'sick' },
    });
    // Wed 23 is Saudi National Day; Fri/Sat are the weekend.
    expect(marks.off).toEqual({
      '2026-09-23': { kind: 'holiday', name: 'Saudi National Day' },
      '2026-09-25': { kind: 'weekend' },
      '2026-09-26': { kind: 'weekend' },
    });
  });
});
