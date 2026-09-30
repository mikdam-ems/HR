import { daysOfMonth } from './dates';
import type { ISODate } from './types';

export type HoursSource = 'clock' | 'schedule';

/**
 * From `from` on, a day's hours come from `source`. Kept as dated periods so a switch never changes days
 * that were already worked, approved or paid under the other source.
 */
export interface HoursPeriod {
  from: ISODate;
  source: HoursSource;
}

/** The source in force on a date: the latest period starting on or before it. Before any period, the schedule. */
export function hoursSourceOn(periods: readonly HoursPeriod[], date: ISODate): HoursSource {
  let source: HoursSource = 'schedule';
  for (const p of periods) if (p.from <= date) source = p.source;
  return source;
}

/** True when at least one day of the month takes its hours from the clock (so clock data is worth loading). */
export function monthUsesClock(periods: readonly HoursPeriod[], year: number, month: number): boolean {
  return daysOfMonth(year, month).some((d) => hoursSourceOn(periods, d) === 'clock');
}

/**
 * Why a new period can't be added, or null. It can't start before the latest period (history stays as it
 * was), and it can't start in or before a closed month (`closedMonths` as "YYYY-MM"), whose numbers are paid.
 */
export function checkNewHoursPeriod(
  periods: readonly HoursPeriod[],
  next: HoursPeriod,
  closedMonths: readonly string[],
): 'before_latest' | 'closed_month' | null {
  const latest = periods[periods.length - 1];
  if (latest && next.from < latest.from) return 'before_latest';
  if (closedMonths.some((m) => next.from.slice(0, 7) <= m)) return 'closed_month';
  return null;
}
