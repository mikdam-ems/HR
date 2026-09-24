import { daysOfMonth } from './dates';
import { resolveDay } from './dayRules';
import type { DayEntry, DayType, ISODate, LeaveType, OvertimeRates, ResolvedDay, RulesContext } from './types';

/** Upper limit before a day is flagged for the manager. */
export const MAX_MINUTES_PER_DAY = 16 * 60;

/** Days the person is expected to work (and that consume leave when taken off). */
export function isWorkday(dayType: DayType): boolean {
  return dayType === 'working' || dayType === 'special_overtime';
}

/** The auto-filled entry: scheduled hours on workdays, nothing on days off. */
export function prefillEntry(day: ResolvedDay): DayEntry {
  return { date: day.date, workedMinutes: isWorkday(day.dayType) ? day.expectedMinutes : 0 };
}

export interface DayTotals {
  expectedMinutes: number;
  workedMinutes: number;
  regularOvertimeMinutes: number;
  specialOvertimeMinutes: number;
  offDayOvertimeMinutes: number;
  /** Overtime minutes multiplied by their rates, for Finance. */
  weightedOvertimeMinutes: number;
  leaveDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeDayTotals(day: ResolvedDay, entry: DayEntry, rates: OvertimeRates): DayTotals {
  const worked = Math.max(0, entry.workedMinutes);
  const workday = isWorkday(day.dayType);
  const leavePortion = workday && entry.leave ? entry.leave.portion : 0;
  const totals: DayTotals = {
    expectedMinutes: day.expectedMinutes,
    workedMinutes: worked,
    regularOvertimeMinutes: 0,
    specialOvertimeMinutes: 0,
    offDayOvertimeMinutes: 0,
    weightedOvertimeMinutes: 0,
    leaveDays: leavePortion,
  };

  if (day.dayType === 'working') {
    const stillExpected = Math.round(day.expectedMinutes * (1 - leavePortion));
    totals.regularOvertimeMinutes = Math.max(0, worked - stillExpected);
  } else if (day.dayType === 'special_overtime') {
    // Every hour worked on a Jordanian holiday counts as special overtime.
    totals.specialOvertimeMinutes = worked;
  } else if (day.dayType === 'weekend' || day.dayType === 'client_holiday') {
    totals.offDayOvertimeMinutes = worked;
  }

  totals.weightedOvertimeMinutes = round2(
    totals.regularOvertimeMinutes * rates.regular +
      totals.specialOvertimeMinutes * rates.special +
      totals.offDayOvertimeMinutes * rates.offDay,
  );
  return totals;
}

export type IssueCode =
  | 'missing_hours'
  | 'too_many_hours'
  | 'leave_on_day_off'
  | 'worked_on_full_leave'
  | 'unassigned';

export interface Issue {
  date: ISODate;
  code: IssueCode;
}

/** The checks the system runs so managers don't have to read every line. */
export function checkDay(day: ResolvedDay, entry: DayEntry): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode) => issues.push({ date: day.date, code });
  const workday = isWorkday(day.dayType);

  if (day.dayType === 'unassigned') add('unassigned');
  if (workday && entry.workedMinutes <= 0 && !entry.leave) add('missing_hours');
  if (entry.workedMinutes > MAX_MINUTES_PER_DAY) add('too_many_hours');
  if (entry.leave && !workday && day.dayType !== 'unassigned') add('leave_on_day_off');
  if (entry.leave?.portion === 1 && entry.workedMinutes > 0) add('worked_on_full_leave');
  return issues;
}

export interface MonthDay {
  day: ResolvedDay;
  entry: DayEntry;
  /** True when the entry differs from the auto-filled one — these are what the manager reviews. */
  changed: boolean;
  totals: DayTotals;
  issues: Issue[];
}

export interface MonthTotals extends Omit<DayTotals, 'leaveDays'> {
  workingDays: number;
  leaveDaysByType: Partial<Record<LeaveType, number>>;
}

export interface MonthSummary {
  employeeId: string;
  year: number;
  month: number;
  days: MonthDay[];
  totals: MonthTotals;
  issues: Issue[];
}

/** Builds a full month: resolves every day, fills in what the employee didn't change, totals and checks. */
export function summarizeMonth(
  ctx: RulesContext,
  employeeId: string,
  year: number,
  month: number,
  entries: readonly DayEntry[],
  rates: OvertimeRates,
): MonthSummary {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const totals: MonthTotals = {
    expectedMinutes: 0,
    workedMinutes: 0,
    regularOvertimeMinutes: 0,
    specialOvertimeMinutes: 0,
    offDayOvertimeMinutes: 0,
    weightedOvertimeMinutes: 0,
    workingDays: 0,
    leaveDaysByType: {},
  };
  const days: MonthDay[] = [];

  for (const date of daysOfMonth(year, month)) {
    const day = resolveDay(ctx, employeeId, date);
    const prefilled = prefillEntry(day);
    const entry = byDate.get(date) ?? prefilled;
    const changed = entry !== prefilled && (entry.workedMinutes !== prefilled.workedMinutes || !!entry.leave);
    const dayTotals = computeDayTotals(day, entry, rates);

    totals.expectedMinutes += dayTotals.expectedMinutes;
    totals.workedMinutes += dayTotals.workedMinutes;
    totals.regularOvertimeMinutes += dayTotals.regularOvertimeMinutes;
    totals.specialOvertimeMinutes += dayTotals.specialOvertimeMinutes;
    totals.offDayOvertimeMinutes += dayTotals.offDayOvertimeMinutes;
    totals.weightedOvertimeMinutes = round2(totals.weightedOvertimeMinutes + dayTotals.weightedOvertimeMinutes);
    if (isWorkday(day.dayType)) totals.workingDays += 1;
    if (entry.leave && dayTotals.leaveDays > 0) {
      const t = entry.leave.type;
      totals.leaveDaysByType[t] = (totals.leaveDaysByType[t] ?? 0) + dayTotals.leaveDays;
    }

    days.push({ day, entry, changed, totals: dayTotals, issues: checkDay(day, entry) });
  }

  return { employeeId, year, month, days, totals, issues: days.flatMap((d) => d.issues) };
}
