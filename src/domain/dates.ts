import type { ISODate, Weekday } from './types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses YYYY-MM-DD as a UTC midnight timestamp, so results never depend on the server's time zone. */
export function toUtcMs(date: ISODate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d);
  if (fromUtcMs(ms) !== date) throw new Error(`Invalid date "${date}"`);
  return ms;
}

export function fromUtcMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayOf(date: ISODate): Weekday {
  return new Date(toUtcMs(date)).getUTCDay() as Weekday;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Every date from `from` to `to`, both included. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let ms = toUtcMs(from), end = toUtcMs(to); ms <= end; ms += DAY_MS) out.push(fromUtcMs(ms));
  return out;
}

/** Every date of a month. `month` is 1–12. */
export function daysOfMonth(year: number, month: number): ISODate[] {
  const first = fromUtcMs(Date.UTC(year, month - 1, 1));
  const last = fromUtcMs(Date.UTC(year, month, 0));
  return eachDay(first, last);
}

/** True when `date` falls between `start` and `end` (both inclusive; null end = open). */
export function isWithin(date: ISODate, start: ISODate, end: ISODate | null): boolean {
  return date >= start && (end === null || date <= end);
}

/** Full years completed between two dates, e.g. for "21 days after 5 years of service". */
export function completedYears(from: ISODate, to: ISODate): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return Math.max(0, years);
}

/** Parses HH:MM into minutes after midnight. */
export function toMinutes(time: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new Error(`Invalid time "${time}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Length of a time window in minutes. A window that ends at or before its start runs past midnight. */
export function windowMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return e > s ? e - s : e + 24 * 60 - s;
}
