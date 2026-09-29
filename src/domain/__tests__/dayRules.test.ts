import { describe, expect, it } from 'vitest';
import { resolveDay } from '../dayRules';
import { computeDayTotals } from '../timesheet';
import { ctx, rates } from './fixtures';

const type = (employeeId: string, date: string) => resolveDay(ctx, employeeId, date).dayType;

describe('day rules (plan: "Day rules" table)', () => {
  it('Saudi holiday, normal day in Jordan → day off, no leave', () => {
    const day = resolveDay(ctx, 'omar', '2026-09-23');
    expect(day.dayType).toBe('client_holiday');
    expect(day.holidayName).toBe('Saudi National Day');
    expect(day.expectedMinutes).toBe(0);
  });

  it('Jordanian holiday while the client is working → special overtime, full hours expected', () => {
    const day = resolveDay(ctx, 'omar', '2026-05-25'); // Monday
    expect(day.dayType).toBe('special_overtime');
    expect(day.holidayName).toBe('Independence Day');
    expect(day.expectedMinutes).toBe(480);
  });

  it('holiday in both countries → client holiday wins', () => {
    expect(type('omar', '2026-06-01')).toBe('client_holiday');
  });

  it('Jordanian holiday on the client weekend → just a weekend', () => {
    expect(type('omar', '2026-05-29')).toBe('weekend'); // Friday
  });

  it('client work week decides weekends: Fri/Sat off for a Sun–Thu client', () => {
    expect(type('omar', '2026-09-04')).toBe('weekend'); // Friday
    expect(type('omar', '2026-09-05')).toBe('weekend'); // Saturday
    expect(type('omar', '2026-09-06')).toBe('working'); // Sunday
  });

  it('a client that works Saturdays makes Saturday a working day', () => {
    expect(type('hala', '2026-09-05')).toBe('working'); // Saturday
    expect(type('hala', '2026-09-04')).toBe('weekend'); // Friday
  });

  it('two clients, only one has a holiday → day off', () => {
    const day = resolveDay(ctx, 'lina', '2026-09-15'); // Client B holiday, Jadwa working
    expect(day.dayType).toBe('client_holiday');
    expect(day.clientIds).toEqual(['jadwa', 'clientB']);
  });

  it('with two clients, the primary one sets the work week', () => {
    // Saturday: Client B works, but Lina's primary (Jadwa) does not.
    const day = resolveDay(ctx, 'lina', '2026-09-12');
    expect(day.primaryClientId).toBe('jadwa');
    expect(day.dayType).toBe('weekend');
  });

  it('moving to a new client switches calendars on the start date', () => {
    expect(resolveDay(ctx, 'sami', '2026-06-30').primaryClientId).toBe('clientB');
    expect(resolveDay(ctx, 'sami', '2026-07-01').primaryClientId).toBe('jadwa');
    expect(type('sami', '2026-06-27')).toBe('working'); // Saturday on Client B
    expect(type('sami', '2026-07-04')).toBe('weekend'); // Saturday on Jadwa
  });

  it('no active assignment → unassigned, nothing expected', () => {
    const day = resolveDay(ctx, 'sami', '2025-12-31');
    expect(day.dayType).toBe('unassigned');
    expect(day.expectedMinutes).toBe(0);
  });
});

describe('schedules', () => {
  it('uses the schedule in effect on the date', () => {
    expect(resolveDay(ctx, 'omar', '2026-09-30').expectedMinutes).toBe(480); // 09:00–17:00
    expect(resolveDay(ctx, 'omar', '2026-10-01').expectedMinutes).toBe(540); // 12:00–21:00
  });

  it('handles a night shift that crosses midnight', () => {
    const day = resolveDay(ctx, 'omar', '2026-11-01');
    expect(day.schedule?.shiftCode).toBe('C');
    expect(day.expectedMinutes).toBe(480); // 22:00–06:00
  });
});

describe('seasonal hours (Ramadan)', () => {
  // Ramadan 2027 at Jadwa: 09:00–15:00 from Sunday 7 February to Monday 8 March.
  const ramadan = { clientId: 'jadwa', name: 'Ramadan 2027', from: '2027-02-07', to: '2027-03-08', start: '09:00', end: '15:00' };
  const withSeason = (extra: Partial<typeof ramadan> & { clientShiftId?: string } = {}) => ({
    ...ctx,
    seasonalHours: [{ ...ramadan, ...extra }],
  });

  it('replaces the usual hours on those dates only', () => {
    const day = resolveDay(withSeason(), 'omar', '2027-02-08');
    expect(day).toMatchObject({ dayType: 'working', expectedMinutes: 6 * 60, seasonName: 'Ramadan 2027' });
    expect(day.schedule).toMatchObject({ start: '09:00', end: '15:00' });
    expect(resolveDay(withSeason(), 'omar', '2027-03-08').expectedMinutes).toBe(6 * 60);
    expect(resolveDay(withSeason(), 'omar', '2027-03-09')).toMatchObject({ expectedMinutes: 8 * 60 });
    expect(resolveDay(withSeason(), 'omar', '2027-03-09').seasonName).toBeUndefined();
  });

  it('leaves weekends as weekends', () => {
    expect(resolveDay(withSeason(), 'omar', '2027-02-12')).toMatchObject({ dayType: 'weekend', expectedMinutes: 0 });
  });

  it('follows the primary client only', () => {
    // Sami is on Client B until 30 June 2026: Jadwa's seasonal hours in May don't apply to him.
    const may = withSeason({ from: '2026-05-01', to: '2026-05-31' });
    expect(resolveDay(may, 'sami', '2026-05-04').seasonName).toBeUndefined();
    expect(resolveDay(may, 'omar', '2026-05-04').seasonName).toBe('Ramadan 2027');
  });

  it('can be limited to one of the client’s shifts', () => {
    expect(resolveDay(withSeason({ clientShiftId: 'night' }), 'omar', '2027-02-08')).toMatchObject({ expectedMinutes: 8 * 60 });
  });

  it('makes overtime start after the shorter day', () => {
    const day = resolveDay(withSeason(), 'omar', '2027-02-08');
    const totals = computeDayTotals(day, { date: day.date, workedMinutes: 8 * 60 }, rates);
    expect(totals.regularOvertimeMinutes).toBe(2 * 60);
  });
});

describe('shift swaps', () => {
  // Omar and Lina both work at Jadwa: Omar mornings, Lina evenings (with Jadwa's Ramadan hours per shift).
  const swapCtx = (swaps = [{ date: '2026-10-05', a: 'omar', b: 'lina' }]) => ({
    ...ctx,
    schedules: [
      ...ctx.schedules.filter((s) => s.employeeId !== 'omar' && s.employeeId !== 'lina'),
      { employeeId: 'omar', effectiveFrom: '2026-01-01', start: '07:00', end: '15:00', clientShiftId: 'morning' },
      { employeeId: 'lina', effectiveFrom: '2026-01-01', start: '15:00', end: '23:00', clientShiftId: 'evening' },
    ],
    swaps,
  });

  it('gives each person the other’s shift on that day only', () => {
    const c = swapCtx();
    expect(resolveDay(c, 'omar', '2026-10-05')).toMatchObject({
      schedule: { employeeId: 'omar', start: '15:00', end: '23:00', clientShiftId: 'evening' },
      swappedWith: 'lina',
    });
    expect(resolveDay(c, 'lina', '2026-10-05').schedule).toMatchObject({ start: '07:00', clientShiftId: 'morning' });
    expect(resolveDay(c, 'omar', '2026-10-06').schedule).toMatchObject({ start: '07:00' });
    expect(resolveDay(c, 'omar', '2026-10-06').swappedWith).toBeUndefined();
  });

  it('special hours for a shift follow whoever works it that day', () => {
    const c = {
      ...swapCtx(),
      seasonalHours: [
        { clientId: 'jadwa', name: 'Ramadan', from: '2026-10-01', to: '2026-10-31', start: '16:00', end: '21:00', clientShiftId: 'evening' },
      ],
    };
    expect(resolveDay(c, 'omar', '2026-10-05')).toMatchObject({ expectedMinutes: 5 * 60, seasonName: 'Ramadan' });
    expect(resolveDay(c, 'lina', '2026-10-05')).toMatchObject({ expectedMinutes: 8 * 60 });
  });
});
