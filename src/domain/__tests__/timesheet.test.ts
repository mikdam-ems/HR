import { describe, expect, it } from 'vitest';
import { resolveDay } from '../dayRules';
import { checkDay, computeDayTotals, sumMonthDays, summarizeMonth } from '../timesheet';
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

describe('clock mode', () => {
  it('takes hours from the clock, leaves future days empty and flags past days with no clock', async () => {
    const EMP = 'omar';
    const s = summarizeMonth(ctx, EMP, 2026, 9, [], rates, { minutes: { '2026-09-15': 10 * 60, '2026-09-16': 8 * 60 }, today: '2026-09-17', since: '2026-09-14' });
    const day = (d: string) => s.days.find((x) => x.day.date === d)!;
    expect(day('2026-09-15').entry.workedMinutes).toBe(600);
    expect(day('2026-09-15').changed).toBe(false);
    expect(day('2026-09-15').totals.regularOvertimeMinutes).toBe(600 - day('2026-09-15').day.expectedMinutes);
    expect(day('2026-09-14').issues.map((i) => i.code)).toContain('missing_hours');
    expect(day('2026-09-17').issues).toEqual([]);
    expect(day('2026-09-20').future).toBe(true);
    expect(day('2026-09-20').entry.workedMinutes).toBe(0);
  });

  it('an approved change still overrides the clock', async () => {
    const EMP = 'omar';
    const s = summarizeMonth(ctx, EMP, 2026, 9, [{ date: '2026-09-15', workedMinutes: 0, leave: { type: 'sick', portion: 1 } }], rates, {
      minutes: { '2026-09-15': 30 },
      today: '2026-09-30',
      since: '2026-09-01',
    });
    const d = s.days.find((x) => x.day.date === '2026-09-15')!;
    expect(d.entry.leave?.type).toBe('sick');
    expect(d.changed).toBe(true);
    expect(d.clockedMinutes).toBe(30);
  });
});

describe('clock mode starts on the first clock-in', () => {
  it('keeps the schedule before someone started clocking, and entirely for people who never clocked', () => {
    const s = summarizeMonth(ctx, 'omar', 2026, 9, [], rates, { minutes: { '2026-09-15': 600 }, today: '2026-09-17', since: '2026-09-15' });
    const day = (d: string) => s.days.find((x) => x.day.date === d)!;
    expect(day('2026-09-14').entry.workedMinutes).toBe(day('2026-09-14').day.expectedMinutes);
    expect(day('2026-09-14').issues).toEqual([]);
    expect(day('2026-09-14').future).toBeUndefined();
    expect(day('2026-09-15').entry.workedMinutes).toBe(600);
    expect(day('2026-09-16').issues.map((i) => i.code)).toContain('missing_hours');

    const never = summarizeMonth(ctx, 'omar', 2026, 9, [], rates, { minutes: {}, today: '2026-09-17', since: null });
    expect(never.days.every((d) => d.future === undefined)).toBe(true);
    expect(never.issues.filter((i) => i.code === 'missing_hours')).toEqual([]);
  });
});

describe('sumMonthDays', () => {
  it('totals the whole month exactly as summarizeMonth does', () => {
    const entries: DayEntry[] = [
      { date: '2026-09-15', workedMinutes: 600 },
      { date: '2026-09-16', workedMinutes: 0, leave: { type: 'annual', portion: 1 } },
    ];
    const month = summarizeMonth(ctx, 'lina', 2026, 9, entries, rates);
    expect(sumMonthDays(month.days)).toEqual(month.totals);
  });

  it('totals only the days given, e.g. those spent at one client', () => {
    // Sami is on Client B until 30 June and on Jadwa from 1 July.
    const june = summarizeMonth(ctx, 'sami', 2026, 6, [], rates);
    const july = summarizeMonth(ctx, 'sami', 2026, 7, [], rates);
    const atJadwa = [...june.days, ...july.days].filter((d) => d.day.primaryClientId === 'jadwa');
    expect(sumMonthDays(atJadwa)).toEqual(july.totals);
  });
});
