import { describe, expect, it } from 'vitest';
import { resolveDay } from '../dayRules';
import { checkDay, computeDayTotals, summarizeMonth } from '../timesheet';
import type { DayEntry } from '../types';
import { ctx, rates } from './fixtures';

const h = (hours: number) => hours * 60;

describe('overtime', () => {
  it('hours beyond the schedule on a working day are regular overtime', () => {
    const day = resolveDay(ctx, 'omar', '2026-08-10');
    const t = computeDayTotals(day, { date: day.date, workedMinutes: h(11) }, rates);
    expect(t.regularOvertimeMinutes).toBe(h(3));
    expect(t.specialOvertimeMinutes).toBe(0);
  });

  it('every hour on a Jordanian holiday counts as special overtime at ×1.2', () => {
    const day = resolveDay(ctx, 'omar', '2026-08-26');
    const t = computeDayTotals(day, { date: day.date, workedMinutes: h(8) }, rates);
    expect(t.specialOvertimeMinutes).toBe(h(8));
    expect(t.weightedOvertimeMinutes).toBe(h(9.6));
  });

  it('hours on a client weekend or client holiday are off-day overtime', () => {
    const weekend = resolveDay(ctx, 'omar', '2026-09-04');
    expect(computeDayTotals(weekend, { date: weekend.date, workedMinutes: h(4) }, rates).offDayOvertimeMinutes).toBe(h(4));
    const holiday = resolveDay(ctx, 'omar', '2026-09-23');
    expect(computeDayTotals(holiday, { date: holiday.date, workedMinutes: h(2) }, rates).offDayOvertimeMinutes).toBe(h(2));
  });

  it('a half day of leave halves what is still expected before overtime starts', () => {
    const day = resolveDay(ctx, 'omar', '2026-08-11');
    const entry: DayEntry = { date: day.date, workedMinutes: h(5), leave: { type: 'annual', portion: 0.5 } };
    const t = computeDayTotals(day, entry, rates);
    expect(t.leaveDays).toBe(0.5);
    expect(t.regularOvertimeMinutes).toBe(h(1));
  });
});

describe('checks', () => {
  const codes = (date: string, entry: Omit<DayEntry, 'date'>, employeeId = 'omar') =>
    checkDay(resolveDay(ctx, employeeId, date), { date, ...entry }).map((i) => i.code);

  it('flags a working day with no hours and no leave', () => {
    expect(codes('2026-08-11', { workedMinutes: 0 })).toEqual(['missing_hours']);
  });

  it('does not flag a day covered by leave', () => {
    expect(codes('2026-08-11', { workedMinutes: 0, leave: { type: 'sick', portion: 1 } })).toEqual([]);
  });

  it('flags more than 16 hours', () => {
    expect(codes('2026-08-11', { workedMinutes: h(17) })).toEqual(['too_many_hours']);
  });

  it('flags leave taken on a client holiday (no leave needed)', () => {
    expect(codes('2026-09-23', { workedMinutes: 0, leave: { type: 'annual', portion: 1 } })).toEqual([
      'leave_on_day_off',
    ]);
  });

  it('flags days with no assignment', () => {
    expect(codes('2025-12-31', { workedMinutes: 0 }, 'sami')).toEqual(['unassigned']);
  });
});

describe('month summary', () => {
  it("matches the wireframe's September for Lina (Jadwa only)", () => {
    const soloCtx = { ...ctx, assignments: ctx.assignments.filter((a) => a.clientId === 'jadwa') };
    const entries: DayEntry[] = [
      { date: '2026-09-08', workedMinutes: 0, leave: { type: 'sick', portion: 1 } },
      { date: '2026-09-15', workedMinutes: h(10) },
      { date: '2026-09-16', workedMinutes: 0, leave: { type: 'annual', portion: 1 } },
      { date: '2026-09-17', workedMinutes: 0, leave: { type: 'annual', portion: 1 } },
    ];
    const m = summarizeMonth(soloCtx, 'lina', 2026, 9, entries, rates);

    expect(m.totals.workingDays).toBe(21); // 22 Sun–Thu days minus Saudi National Day
    expect(m.totals.expectedMinutes).toBe(h(168));
    expect(m.totals.workedMinutes).toBe(h(146));
    expect(m.totals.regularOvertimeMinutes).toBe(h(2));
    expect(m.totals.leaveDaysByType).toEqual({ sick: 1, annual: 2 });
    expect(m.issues).toEqual([]);
    expect(m.days.filter((d) => d.changed).map((d) => d.day.date)).toEqual([
      '2026-09-08',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    ]);
  });

  it("matches the approvals wireframe's August for Omar", () => {
    const entries: DayEntry[] = [
      { date: '2026-08-10', workedMinutes: h(11) },
      { date: '2026-08-20', workedMinutes: 0, leave: { type: 'sick', portion: 1 } },
    ];
    const m = summarizeMonth(ctx, 'omar', 2026, 8, entries, rates);

    expect(m.totals.workingDays).toBe(22);
    expect(m.totals.workedMinutes).toBe(h(171));
    expect(m.totals.regularOvertimeMinutes).toBe(h(3));
    expect(m.totals.specialOvertimeMinutes).toBe(h(8)); // 26 Aug, auto-filled
    expect(m.totals.weightedOvertimeMinutes).toBe(h(3) + h(9.6));
  });
});
