import { describe, expect, it } from 'vitest';
import { checkNewHoursPeriod, hoursSourceOn, monthUsesClock } from '../hoursSource';
import { summarizeMonth } from '../timesheet';
import { ctx, rates } from './fixtures';

const periods = [
  { from: '2026-10-01', source: 'clock' as const },
  { from: '2027-01-01', source: 'schedule' as const },
];

describe('where hours come from on a date', () => {
  it('the latest period starting on or before the date; before any period, the schedule', () => {
    expect(hoursSourceOn(periods, '2026-09-30')).toBe('schedule');
    expect(hoursSourceOn(periods, '2026-10-01')).toBe('clock');
    expect(hoursSourceOn(periods, '2026-12-31')).toBe('clock');
    expect(hoursSourceOn(periods, '2027-01-01')).toBe('schedule');
    expect(hoursSourceOn([], '2026-10-01')).toBe('schedule');
  });

  it('knows whether a month needs clock data at all', () => {
    expect(monthUsesClock(periods, 2026, 9)).toBe(false);
    expect(monthUsesClock(periods, 2026, 10)).toBe(true);
    expect(monthUsesClock(periods, 2027, 1)).toBe(false);
    expect(monthUsesClock([{ from: '2026-09-15', source: 'clock' }], 2026, 9)).toBe(true);
  });
});

describe('switching never changes days before the switch', () => {
  it('a month that starts on the schedule and switches to the clock mid-month', () => {
    const s = summarizeMonth(ctx, 'omar', 2026, 9, [], rates, {
      minutes: { '2026-09-14': 600, '2026-09-21': 600 },
      today: '2026-09-28',
      since: '2026-09-01',
      periods: [{ from: '2026-09-20', source: 'clock' }],
    });
    const day = (d: string) => s.days.find((x) => x.day.date === d)!;
    // Before the switch: the schedule, whatever the clock says.
    expect(day('2026-09-14').entry.workedMinutes).toBe(day('2026-09-14').day.expectedMinutes);
    expect(day('2026-09-14').future).toBeUndefined();
    // From the switch: the clock.
    expect(day('2026-09-21').entry.workedMinutes).toBe(600);
    expect(day('2026-09-22').issues.map((i) => i.code)).toContain('missing_hours');
  });
});

describe('a new period', () => {
  it('must start on or after the latest one, and not in or before a closed month', () => {
    expect(checkNewHoursPeriod(periods, { from: '2027-02-01', source: 'clock' }, [])).toBeNull();
    expect(checkNewHoursPeriod(periods, { from: '2026-12-01', source: 'clock' }, [])).toBe('before_latest');
    expect(checkNewHoursPeriod([], { from: '2026-09-15', source: 'clock' }, ['2026-09'])).toBe('closed_month');
    expect(checkNewHoursPeriod([], { from: '2026-08-15', source: 'clock' }, ['2026-09'])).toBe('closed_month');
    expect(checkNewHoursPeriod([], { from: '2026-10-01', source: 'clock' }, ['2026-09'])).toBeNull();
  });
});
